import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const GUILD_ID = process.env.GUILD_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!GUILD_ID || !BOT_TOKEN) {
    console.error("Missing GUILD_ID or BOT_TOKEN in .env!");
    process.exit(1);
}

const CACHE_DIR = path.join(process.cwd(), "public", "cache");
const AVATARS_DIR = path.join(CACHE_DIR, "avatars");
const USERS_JSON = path.join(CACHE_DIR, "users.json");

async function setupDirectories() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.mkdir(AVATARS_DIR, { recursive: true });
}

async function clearCache() {
    try {
        // Remove avatars directory and users.json if they exist
        await fs.rm(AVATARS_DIR, { recursive: true, force: true });
        await fs.rm(USERS_JSON, { force: true });
        await fs.mkdir(AVATARS_DIR, { recursive: true });
        console.log("🧹 Cleared avatar cache and users.json file.");
    } catch (err) {
        console.error("Failed to clear cache:", err);
    }
}

// Download avatar and save locally
async function downloadAvatar(userId, avatarHash) {
    if (!avatarHash) return null;
    const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
    const filename = `${userId}.png`;
    const filepath = path.join(AVATARS_DIR, filename);

    try {
        const res = await fetch(avatarUrl);
        if (!res.ok) {
            console.warn(`Failed to fetch avatar for ${userId} (HTTP ${res.status})`);
            return null;
        }

        await pipeline(res.body, createWriteStream(filepath));
        return `/cache/avatars/${filename}`;
    } catch (err) {
        console.error(`Error downloading avatar for ${userId}:`, err.message);
        return null;
    }
}

// Fetch all guild members in pages of 1000
async function fetchAllGuildMembers() {
    let allMembers = [];
    let after = "0";
    let done = false;
    let page = 1;

    while (!done) {
        const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000&after=${after}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });

        if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after") || 5;
            console.warn(`Rate limited, waiting ${retryAfter}s...`);
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
        }

        if (!res.ok) {
            console.error(`Failed to fetch members: HTTP ${res.status}`);
            break;
        }

        const members = await res.json();
        if (members.length === 0) {
            done = true;
        } else {
            console.log(`Fetched page ${page} (${members.length} members)`);
            allMembers.push(...members);
            after = members[members.length - 1].user.id;
            page++;
        }
    }

    return allMembers;
}

// Main
async function main() {
    console.log("Starting Discord user cache update...");

    await setupDirectories();
    await clearCache();

    console.log("Fetching guild members...");
    const members = await fetchAllGuildMembers();
    console.log(`Fetched ${members.length} members.`);

    const users = {};
    let processed = 0;

    for (const member of members) {
        const user = member.user;
        const avatarPath = await downloadAvatar(user.id, user.avatar);
        users[user.id] = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator || "0",
            avatar: avatarPath,
            display_name: member.nick || user.global_name || user.username,
            hasAvatar: !!avatarPath,
            inGuild: true,
        };

        processed++;
        if (processed % 100 === 0) {
            console.log(`Processed ${processed}/${members.length} users...`);
            await new Promise(r => setTimeout(r, 1000)); // small pause for rate limit safety
        }
    }

    const cacheData = {
        users,
        totalUsers: Object.keys(users).length,
        lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(USERS_JSON, JSON.stringify(cacheData, null, 2));
    console.log(`✅ User cache updated! Saved to ${USERS_JSON}`);
    console.log(`📸 Avatars saved to ${AVATARS_DIR}`);
    console.log(`👥 Total users: ${Object.keys(users).length}`);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
