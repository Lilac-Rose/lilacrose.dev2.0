import os
import json
import sqlite3
import subprocess
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory, request, redirect, session
from flask_session import Session
from flask_discord import DiscordOAuth2Session, requires_authorization
import redis

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SESSION_SECRET", "change_this")
app.config["DISCORD_CLIENT_ID"] = os.getenv("DISCORD_CLIENT_ID")
app.config["DISCORD_CLIENT_SECRET"] = os.getenv("DISCORD_CLIENT_SECRET")
app.config["DISCORD_REDIRECT_URI"] = os.getenv("DISCORD_CALLBACK_URL")
app.config["DISCORD_BOT_TOKEN"] = os.getenv("BOT_TOKEN")
app.config["DISCORD_SCOPES"] = ["identify"]
app.config["ENV"] = os.getenv("FLASK_ENV", "production")
app.config["DEBUG"] = os.getenv("FLASK_DEBUG", "False").lower() == "true"

# Redis session configuration
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
app.config["SESSION_TYPE"] = "redis"
app.config["SESSION_REDIS"] = redis_client
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "None" if os.getenv("FLASK_ENV") == "production" else "Lax"

Session(app)
discord = DiscordOAuth2Session(app)

PORT = int(os.getenv("PORT", 3100))
CONFIG_PATH = Path.cwd() / "xp_config.json"
LIFETIME_DB = "/home/lilacrose/Lacie/xp/databases/lifetime.db"
ANNUAL_DB = "/home/lilacrose/Lacie/xp/databases/annual.db"
USERS_CACHE = Path.cwd() / "public" / "cache" / "users.json"
GUILD_ID = os.getenv("GUILD_ID")
STAFF_ROLE_ID = os.getenv("STAFF_ROLE_ID", "952560403970416722")

# -----------------------
# Helper: Avatar builder
# -----------------------
def build_avatar_url(user_id, avatar_hash):
    """
    Returns a usable CDN avatar URL given a user id and avatar hash.
    If no avatar_hash is provided, returns one of the default embed avatars.
    """
    try:
        if not avatar_hash:
            # Default embed avatars: 0..4, just return 0 as a fallback
            return "https://cdn.discordapp.com/embed/avatars/0.png"
        return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png?size=4096"
    except Exception:
        return None

# Helper: Get guild roles from Discord API
def get_guild_roles():
    try:
        response = requests.get(
            f"https://discord.com/api/v10/guilds/{GUILD_ID}/roles",
            headers={"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"},
            timeout=10
        )
        if not response.ok:
            print("get_guild_roles failed:", response.status_code, response.text)
            return {}
        roles = response.json()
        return {role["id"]: {"name": role["name"], "color": role["color"]} for role in roles}
    except Exception as err:
        print(f"Error fetching roles: {err}")
        return {}

# Helper: Get XP data from SQLite
def get_xp_data(db_path, limit=100, offset=0):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, xp, level FROM xp ORDER BY xp DESC LIMIT ? OFFSET ?", (limit, offset))
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

# Helper: Get user rank from SQLite
def get_user_rank(db_path, user_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, xp, level, last_message,
        (SELECT COUNT(*) + 1 FROM xp AS x2 WHERE x2.xp > x1.xp) as rank,
        (SELECT COUNT(*) FROM xp) as total_users
        FROM xp AS x1 
        WHERE user_id = ?
    """, (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

# XP calculation functions
def xp_for_level(level):
    config = json.loads(CONFIG_PATH.read_text())
    curve = config.get("XP_CURVE", {"base": 1, "square": 50, "linear": 100, "divisor": 100})
    xp = int((level ** 3 * curve["base"] + level ** 2 * curve["square"] + level * curve["linear"]) / curve["divisor"])
    return (xp // 100) * 100

def get_multiplier(user_roles, guild_roles):
    config = json.loads(CONFIG_PATH.read_text())
    multipliers = config.get("MULTIPLIERS", {})
    highest_multiplier = 1.0
    multiplier_role = None
    for role_id in user_roles:
        if role_id in multipliers and multipliers[role_id] > highest_multiplier:
            highest_multiplier = multipliers[role_id]
            multiplier_role = role_id
    return {
        "multiplier": highest_multiplier,
        "role_id": multiplier_role,
        "role_name": guild_roles.get(multiplier_role, {}).get("name") if multiplier_role else None
    }

# Helper: Get user from cache
def get_user_from_cache(user_id):
    try:
        cache_data = json.loads(USERS_CACHE.read_text())
        if "users" in cache_data and user_id in cache_data["users"]:
            return cache_data["users"][user_id]
        return {
            "id": user_id,
            "username": f"User{user_id[:6]}",
            "discriminator": "0",
            "avatar": None,
            "display_name": f"User{user_id[:6]}",
            "hasAvatar": False,
            "inGuild": False
        }
    except Exception as error:
        print(f"Error reading user cache: {error}")
        return {
            "id": user_id,
            "username": f"User{user_id[:6]}",
            "discriminator": "0",
            "avatar": None,
            "display_name": f"User{user_id[:6]}",
            "hasAvatar": False,
            "inGuild": False
        }

def enrich_users(users):
    enriched = []
    for user in users:
        user_data = get_user_from_cache(user["user_id"])
        enriched.append({**user, **user_data})
    return enriched

# -----------------------
# Middleware: Guild checks
# -----------------------
def check_in_guild():
    """
    Returns True if the currently authenticated OAuth user is a member of GUILD_ID.
    Uses the bot token to query the guild member endpoint.
    Prints debug info to help diagnose 403/404/missing-intent issues.
    """
    if not discord.authorized:
        print("check_in_guild: not authorized")
        return False
    try:
        user = discord.fetch_user()
        url = f"https://discord.com/api/v10/guilds/{GUILD_ID}/members/{user.id}"
        headers = {"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"}
        response = requests.get(url, headers=headers, timeout=10)
        print("check_in_guild:", response.status_code, response.text[:400])
        return response.status_code == 200
    except Exception as e:
        print("check_in_guild error:", e)
        return False

def check_staff():
    """
    Returns True if the currently authenticated OAuth user has the staff role in the guild.
    """
    if not discord.authorized:
        print("check_staff: not authorized")
        return False
    try:
        user = discord.fetch_user()
        url = f"https://discord.com/api/v10/guilds/{GUILD_ID}/members/{user.id}"
        headers = {"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"}
        response = requests.get(url, headers=headers, timeout=10)
        print("check_staff membership fetch:", response.status_code)
        if response.status_code != 200:
            print("check_staff failed to fetch member:", response.status_code, response.text[:400])
            return False
        member_data = response.json()
        roles = member_data.get("roles", [])
        return STAFF_ROLE_ID in roles
    except Exception as e:
        print("check_staff error:", e)
        return False

# Static files
@app.route("/lacie/<path:filename>")
def serve_static(filename):
    return send_from_directory("public", filename)

# Main dashboard data endpoint
@app.route("/lacie/api/data")
@requires_authorization
def api_data():
    try:
        config = json.loads(CONFIG_PATH.read_text())
        roles = get_guild_roles()

        # Get XP data
        lifetime_top = get_xp_data(LIFETIME_DB, 100, 0)
        annual_top = get_xp_data(ANNUAL_DB, 100, 0)

        # Enrich users
        lifetime_users = enrich_users(lifetime_top)
        annual_users = enrich_users(annual_top)

        # Check guild membership and staff role
        user = discord.fetch_user()
        is_in_guild = check_in_guild()
        is_staff = check_staff() if is_in_guild else False

        return jsonify({
            "user": {
                "id": str(user.id),
                "username": user.username,
                "avatar": build_avatar_url(user.id, getattr(user, "avatar", None)),
                "isInGuild": is_in_guild,
                "isStaff": is_staff
            },
            "config": config,
            "roles": roles,
            "lifetimeUsers": lifetime_users,
            "annualUsers": annual_users
        })

    except Exception as err:
        print(f"Error loading dashboard data: {err}")
        return jsonify({"error": "Error loading dashboard data"}), 500

# Refresh cache endpoint
@app.route("/lacie/api/refresh-cache", methods=["POST"])
@requires_authorization
def refresh_cache():
    if not check_in_guild():
        return jsonify({"error": "You must be in the server"}), 403

    if not check_staff():
        return jsonify({"error": "You need the Staff role"}), 403

    try:
        script_path = Path.cwd() / "cache_users.js"
        subprocess.Popen(["node", str(script_path)])
        return jsonify({"success": True, "message": "Cache refresh initiated"})
    except Exception as error:
        print(f"Error refreshing cache: {error}")
        return jsonify({"error": "Failed to refresh cache"}), 500

# Stats endpoint
@app.route("/lacie/api/stats")
@requires_authorization
def api_stats():
    try:
        # Try bot API first
        try:
            response = requests.get('http://localhost:8765/stats', timeout=3)
            if response.ok:
                stats = response.json()
                print('Got real-time stats from bot API')
                return jsonify({
                    "memberCount": stats.get("server", {}).get("memberCount", 0),
                    "createdDate": stats.get("server", {}).get("createdDate", "Unknown"),
                    "textChannels": stats.get("server", {}).get("textChannels", 0),
                    "voiceChannels": stats.get("server", {}).get("voiceChannels", 0),
                    "categories": stats.get("server", {}).get("categories", 0),
                    "boostLevel": stats.get("server", {}).get("boostLevel", 0),
                    "boostCount": stats.get("server", {}).get("boostCount", 0),
                    "uptime": stats.get("bot", {}).get("uptime", "0h 0m 0s"),
                    "totalCommands": stats.get("bot", {}).get("totalCommands", 0),
                    "serverCount": stats.get("bot", {}).get("serverCount", 0),
                    "botUsers": stats.get("bot", {}).get("botUsers", 0),
                    "latency": stats.get("bot", {}).get("latency", 0),
                    "lastUpdated": stats.get("bot", {}).get("lastUpdated", "Never"),
                    "guildName": stats.get("server", {}).get("guildName", "Unknown"),
                    "source": "bot-api"
                })
        except Exception:
            print('Bot API not available, falling back to JSON file')

        # Fall back to JSON file
        stats_path = Path("/home/lilacrose/Lacie/commands/bot_stats.json")
        if stats_path.exists():
            stats = json.loads(stats_path.read_text())
            print('Got stats from JSON file')
            return jsonify({
                "memberCount": stats.get("server", {}).get("memberCount", 0),
                "createdDate": stats.get("server", {}).get("createdDate", "Unknown"),
                "textChannels": stats.get("server", {}).get("textChannels", 0),
                "voiceChannels": stats.get("server", {}).get("voiceChannels", 0),
                "categories": stats.get("server", {}).get("categories", 0),
                "boostLevel": stats.get("server", {}).get("boostLevel", 0),
                "boostCount": stats.get("server", {}).get("boostCount", 0),
                "uptime": stats.get("bot", {}).get("uptime", "0h 0m 0s"),
                "totalCommands": stats.get("bot", {}).get("totalCommands", 0),
                "serverCount": stats.get("bot", {}).get("serverCount", 0),
                "botUsers": stats.get("bot", {}).get("botUsers", 0),
                "latency": stats.get("bot", {}).get("latency", 0),
                "lastUpdated": stats.get("bot", {}).get("lastUpdated", "Never"),
                "guildName": stats.get("server", {}).get("guildName", "Unknown"),
                "source": "json-file"
            })

        # Final fallback to Discord API
        return fallback_stats()

    except Exception as err:
        print(f"Error loading stats: {err}")
        return jsonify({"error": "Error loading statistics"}), 500

def fallback_stats():
    try:
        print('Using fallback Discord API stats')
        guild_response = requests.get(
            f"https://discord.com/api/v10/guilds/{GUILD_ID}",
            headers={"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"},
            timeout=10
        )
        if not guild_response.ok:
            raise Exception('Failed to fetch guild data')
        guild = guild_response.json()

        # Get channels
        channels_response = requests.get(
            f"https://discord.com/api/v10/guilds/{GUILD_ID}/channels",
            headers={"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"},
            timeout=10
        )

        text_channels = 0
        voice_channels = 0
        categories = 0
        if channels_response.ok:
            channels = channels_response.json()
            text_channels = sum(1 for c in channels if c.get("type") == 0)
            voice_channels = sum(1 for c in channels if c.get("type") == 2)
            categories = sum(1 for c in channels if c.get("type") == 4)

        created_date = "Unknown"
        try:
            if guild.get("created_at"):
                created_date = datetime.fromisoformat(guild.get("created_at")).strftime("%b %d, %Y")
        except Exception:
            created_date = "Unknown"

        return jsonify({
            "memberCount": guild.get("approximate_member_count", guild.get("member_count", 0)),
            "createdDate": created_date,
            "textChannels": text_channels,
            "voiceChannels": voice_channels,
            "categories": categories,
            "boostLevel": guild.get("premium_tier", 0),
            "boostCount": guild.get("premium_subscription_count", 0),
            "uptime": "Unknown",
            "totalCommands": 0,
            "serverCount": 1,
            "botUsers": guild.get("approximate_member_count", guild.get("member_count", 0)),
            "latency": 0,
            "lastUpdated": datetime.now().isoformat(),
            "guildName": guild.get("name", "Unknown"),
            "source": "discord-api"
        })
    except Exception as err:
        print(f"Error in fallback stats: {err}")
        return jsonify({"error": "Error loading statistics"}), 500

# User rank endpoint
@app.route("/lacie/api/user/<user_id>/rank")
@requires_authorization
def user_rank(user_id):
    if not check_in_guild():
        return jsonify({"error": "You must be in the server"}), 403

    try:
        config = json.loads(CONFIG_PATH.read_text())
        roles = get_guild_roles()

        print(f"Fetching detailed rank data for user: {user_id}")

        # Get user data from both databases
        lifetime_rank = get_user_rank(LIFETIME_DB, user_id)
        annual_rank = get_user_rank(ANNUAL_DB, user_id)

        # Get Discord user info
        user_info = None
        user_roles = []

        try:
            member_response = requests.get(
                f"https://discord.com/api/v10/guilds/{GUILD_ID}/members/{user_id}",
                headers={"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"},
                timeout=10
            )
            print("user_rank member fetch:", member_response.status_code)
            if member_response.ok:
                member_data = member_response.json()
                user_roles = member_data.get("roles", [])
                user_info = {
                    "id": member_data["user"]["id"],
                    "username": member_data["user"]["username"],
                    "discriminator": member_data["user"]["discriminator"],
                    "avatar": build_avatar_url(member_data["user"]["id"], member_data["user"].get("avatar")),
                    "display_name": member_data.get("nick") or member_data["user"].get("global_name") or member_data["user"]["username"]
                }
            else:
                # Fallback to basic user info
                user_response = requests.get(
                    f"https://discord.com/api/v10/users/{user_id}",
                    headers={"Authorization": f"Bot {app.config['DISCORD_BOT_TOKEN']}"},
                    timeout=10
                )
                print("user_rank user fetch:", user_response.status_code if user_response is not None else "no response")
                if user_response and user_response.ok:
                    user_data = user_response.json()
                    user_info = {
                        "id": user_data["id"],
                        "username": user_data["username"],
                        "discriminator": user_data["discriminator"],
                        "avatar": build_avatar_url(user_data["id"], user_data.get("avatar")),
                        "display_name": user_data.get("global_name") or user_data["username"]
                    }
        except Exception as err:
            print(f"Error fetching user info: {err}")

        # Process rank data
        def process_rank_data(rank_data, is_lifetime=False):
            if not rank_data:
                return None

            xp = rank_data["xp"]
            level = rank_data["level"]
            rank = rank_data["rank"]
            total_users = rank_data["total_users"]
            last_message = rank_data["last_message"]

            current_level_xp = xp_for_level(level)
            next_level_xp = xp_for_level(level + 1)
            xp_in_level = xp - current_level_xp
            xp_needed_for_level = next_level_xp - current_level_xp
            xp_needed = next_level_xp - xp
            progress_percent = (xp_in_level / xp_needed_for_level) * 100 if xp_needed_for_level > 0 else 100

            multiplier_info = {"multiplier": 1.0, "role_name": None}
            if is_lifetime and user_roles:
                multiplier_info = get_multiplier(user_roles, roles)

            min_msgs = int(((xp_needed + 99) // 100) / multiplier_info["multiplier"])
            max_msgs = int(((xp_needed + 49) // 50) / multiplier_info["multiplier"])

            remaining_cd = config["COOLDOWN"] - (datetime.now().timestamp() - last_message)
            cooldown = f"{int(remaining_cd)}s" if remaining_cd > 0 else "None!"

            bar_length = 20
            filled = int((progress_percent / 100) * bar_length)
            bar = "█" * filled + "░" * (bar_length - filled)

            return {
                "xp": xp,
                "level": level,
                "rank": rank,
                "total_users": total_users,
                "current_level_xp": current_level_xp,
                "next_level_xp": next_level_xp,
                "xp_in_level": xp_in_level,
                "xp_needed_for_level": xp_needed_for_level,
                "xp_needed": xp_needed,
                "progress_percent": progress_percent,
                "progress_bar": bar,
                "multiplier": multiplier_info["multiplier"],
                "multiplier_role": multiplier_info["role_name"],
                "min_messages": min_msgs,
                "max_messages": max_msgs,
                "cooldown": cooldown
            }

        return jsonify({
            "user": user_info,
            "lifetime": process_rank_data(lifetime_rank, True),
            "annual": process_rank_data(annual_rank, False),
            "config": {"COOLDOWN": config["COOLDOWN"]}
        })

    except Exception as err:
        print(f"Error in rank API: {err}")
        return jsonify({"error": f"Error loading user rank data: {err}"}), 500

# Config update endpoint
@app.route("/lacie/api/config", methods=["POST"])
@requires_authorization
def update_config():
    if not check_in_guild():
        return jsonify({"error": "You must be in the server"}), 403

    if not check_staff():
        return jsonify({"error": "You need the Staff role"}), 403

    try:
        data = request.get_json()
        new_config = {
            "COOLDOWN": int(data.get("COOLDOWN", 60)),
            "ROLE_REWARDS": data.get("ROLE_REWARDS"),
            "MULTIPLIERS": data.get("MULTIPLIERS"),
            "XP_CURVE": data.get("XP_CURVE", {"base": 1, "square": 50, "linear": 100, "divisor": 100}),
            "RANDOM_XP": data.get("RANDOM_XP", {"min": 50, "max": 100})
        }
        CONFIG_PATH.write_text(json.dumps(new_config, indent=4))
        return jsonify({"success": True, "config": new_config})
    except Exception as err:
        print(f"Config save error: {err}")
        return jsonify({"error": "Invalid configuration format"}), 400

# Discord OAuth routes
@app.route("/lacie/login")
def login():
    return_to = request.args.get("returnTo")
    if return_to:
        session["returnTo"] = return_to
    return discord.create_session(scope=["identify", "guilds"])

@app.route("/lacie/callback")
def callback():
    discord.callback()
    return_to = session.pop("returnTo", "/lacie/")
    return redirect(return_to)

@app.route("/lacie/logout")
def logout():
    discord.revoke()
    session.clear()
    return redirect("/lacie/")

# Auth status endpoint
@app.route("/lacie/api/auth-status")
def auth_status():
    print("AUTH-STATUS ROUTE RUNNING")
    
    if not discord.authorized:
        return jsonify({"authenticated": False})

    user = discord.fetch_user()
    guilds = discord.fetch_guilds()

    REQUIRED_GUILD_ID = 876772600704020530
    in_guild = any(int(g.id) == REQUIRED_GUILD_ID for g in guilds)

    return jsonify({
        "authenticated": True,
        "in_guild": in_guild,
        "user": {
            "id": str(user.id),
            "username": user.username,
            "avatar": build_avatar_url(
                user.id,
                getattr(user, "avatar", None)
            )
        }
    })


# Main pages
@app.route("/lacie")
@app.route("/lacie/")
@app.route("/lacie/dashboard")
def dashboard():
    if not discord.authorized:
        return redirect("/lacie/login")
    return send_from_directory("public", "index.html")

if __name__ == "__main__":
    print(f"Lacie dashboard running on port {PORT}")
    app.run(host="0.0.0.0", port=PORT)
