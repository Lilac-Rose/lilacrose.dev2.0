let dashboardData = null;
let currentLeaderboardType = 'lifetime';
let currentPage = 1;
const USERS_PER_PAGE = 10;

// Configuration Editor Variables
let roleRewardCounter = 0;
let multiplierCounter = 0;

// Authentication
async function checkAuthStatus() {
    try {
        const response = await fetch('/lacie/api/auth-status', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const status = await response.json();
            return status.authenticated;
        }
        return false;
    } catch (error) {
        console.error('Error checking auth status:', error);
        return false;
    }
}

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.dataset.page;
            
            // Update active nav item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Show target page
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(`${targetPage}Page`).classList.add('active');
            
            // Load data if needed
            if (targetPage === 'stats' && !window.statsData) {
                loadStatsData();
            }
        });
    });
}

// Stats Page Functions
async function loadStatsData() {
    try {
        const response = await fetch('/lacie/api/stats', {
            credentials: 'include'
        });
        
        if (response.ok) {
            window.statsData = await response.json();
            renderStatsPage();
        } else {
            console.error('Failed to load stats data');
        }
    } catch (error) {
        console.error('Error loading stats data:', error);
    }
}

function renderStatsPage() {
    const stats = window.statsData;
    if (!stats) return;

    // Update stats page elements safely
    const elements = {
        'totalMembers': stats.memberCount?.toLocaleString() || '0',
        'textChannels': stats.textChannels || '0',
        'voiceChannels': stats.voiceChannels || '0',
        'serverBoosts': stats.boostCount || '0',
        'memberCount': stats.memberCount?.toLocaleString() || '0',
        'createdDate': stats.createdDate || 'Unknown',
        'totalTextChannels': stats.textChannels || '0',
        'totalVoiceChannels': stats.voiceChannels || '0',
        'totalCategories': stats.categories || '0',
        'boostLevel': stats.boostLevel || '0',
        'boostCount': stats.boostCount || '0',
        'botUptime': stats.uptime || '0h 0m 0s',
        'totalCommands': stats.totalCommands?.toLocaleString() || '0',
        'serverCount': stats.serverCount || '0',
        'botUsers': stats.botUsers?.toLocaleString() || '0'
    };

    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
}

// Pagination Functions
function initPagination() {
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    
    if (!prevBtn || !nextBtn || !pageInfo) return;
    
    prevBtn.addEventListener('click', () => changePage(-1));
    nextBtn.addEventListener('click', () => changePage(1));
}

function changePage(direction) {
    if (!dashboardData) return;
    
    const users = currentLeaderboardType === 'lifetime' ? dashboardData.lifetimeUsers : dashboardData.annualUsers;
    const totalPages = Math.ceil(users.length / USERS_PER_PAGE);
    
    currentPage += direction;
    
    // Validate page bounds
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    
    renderCurrentLeaderboard();
    updatePaginationControls(users.length);
}

function updatePaginationControls(totalUsers) {
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    
    if (!prevBtn || !nextBtn || !pageInfo) return;
    
    const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE);
    
    // Update button states
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages || totalPages === 0;
    
    // Update page info
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalUsers} total users)`;
}

// XP Page Functions
function initLeaderboardTabs() {
    const tabs = document.querySelectorAll('.leaderboard-tab');
    
    if (!tabs.length) return;
    
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            
            // Update active tab
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update active leaderboard
            document.querySelectorAll('.leaderboard').forEach(lb => lb.style.display = 'none');
            const targetLeaderboard = document.getElementById(`${type}Leaderboard`);
            if (targetLeaderboard) targetLeaderboard.style.display = 'flex';
            
            // Reset to first page when switching leaderboards
            currentPage = 1;
            currentLeaderboardType = type;
            renderCurrentLeaderboard();
        });
    });
}

function renderCurrentLeaderboard() {
    if (!dashboardData) return;
    
    const users = currentLeaderboardType === 'lifetime' ? dashboardData.lifetimeUsers : dashboardData.annualUsers;
    renderLeaderboard(`${currentLeaderboardType}Leaderboard`, users);
    updatePaginationControls(users.length);
}

function renderLeaderboard(elementId, users) {
    const container = document.getElementById(elementId);
    if (!container) return;
    
    // Calculate pagination slice
    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = startIndex + USERS_PER_PAGE;
    const pageUsers = users.slice(startIndex, endIndex);
    
    container.innerHTML = pageUsers.map((u, i) => {
        const globalRank = startIndex + i + 1;
        const rankClass = globalRank === 1 ? 'rank-1' : globalRank === 2 ? 'rank-2' : globalRank === 3 ? 'rank-3' : '';
        
        // Use enriched data from cache
        const displayName = u.username || `User${u.user_id.substring(0,6)}`;
        const hasAvatar = u.hasAvatar || false;
        const avatar = u.avatar || null;
        
        // Use local cached avatar if available, otherwise placeholder
        const avatarHtml = hasAvatar && avatar
            ? `<img src="/lacie${avatar}" alt="${displayName}" class="leaderboard-avatar">`
            : `<div class="leaderboard-avatar-placeholder">${displayName.charAt(0)}</div>`;
        
        return `
            <div class="leaderboard-item" onclick="viewUserRank('${u.user_id}')">
                <div class="rank ${rankClass}">${globalRank}</div>
                ${avatarHtml}
                <div class="leaderboard-info">
                    <div class="username">${displayName}</div>
                    <div class="stats">
                        <span class="level">Level ${u.level}</span>
                        <span class="xp">${u.xp.toLocaleString()} XP</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Show empty state if no users
    if (pageUsers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No users found in this leaderboard</p>
            </div>
        `;
    }
}

function getRoleColor(roleId) {
    if (!dashboardData || !dashboardData.roles) return '#5865F2';
    const role = dashboardData.roles[roleId];
    if (role && role.color) {
        return '#' + role.color.toString(16).padStart(6, '0');
    }
    return '#5865F2';
}

function getRoleName(roleId) {
    if (!dashboardData || !dashboardData.roles) return `Role ${roleId}`;
    return dashboardData.roles[roleId]?.name || `Role ${roleId}`;
}

function renderConfig(config, roles) {
    if (!config) return;
    
    // Cooldown
    const cooldownDisplay = document.getElementById('cooldownDisplay');
    if (cooldownDisplay) {
        cooldownDisplay.innerHTML = `<strong>${config.COOLDOWN} seconds</strong>`;
    }
    
    // Random XP
    const randomXpDisplay = document.getElementById('randomXpDisplay');
    if (randomXpDisplay) {
        const randomXp = config.RANDOM_XP || { min: 50, max: 100 };
        randomXpDisplay.innerHTML = `${randomXp.min} - ${randomXp.max} XP per message`;
    }
    
    // XP Curve
    const xpCurveDisplay = document.getElementById('xpCurveDisplay');
    if (xpCurveDisplay) {
        const curve = config.XP_CURVE || { base: 1, square: 50, linear: 100, divisor: 100 };
        xpCurveDisplay.innerHTML = `(level³ × ${curve.base}) + (level² × ${curve.square}) + (level × ${curve.linear}) ÷ ${curve.divisor}`;
    }
    
    // Role Rewards
    const roleRewardsList = document.getElementById('roleRewardsList');
    if (roleRewardsList && config.ROLE_REWARDS) {
        roleRewardsList.innerHTML = Object.entries(config.ROLE_REWARDS).map(([level, roleId]) => `
            <div class="role-reward-item">
                <span class="reward-level">Level ${level}</span>
                <span class="arrow">→</span>
                <span class="role-badge" style="background-color: ${getRoleColor(roleId)}">
                    ${getRoleName(roleId)}
                </span>
            </div>
        `).join('');
    }
    
    // Multipliers
    const multipliersList = document.getElementById('multipliersList');
    if (multipliersList && config.MULTIPLIERS) {
        const sortedMultipliers = Object.entries(config.MULTIPLIERS).sort((a, b) => b[1] - a[1]);
        multipliersList.innerHTML = sortedMultipliers.map(([roleId, mult]) => `
            <div class="multiplier-item">
                <span class="role-badge" style="background-color: ${getRoleColor(roleId)}">
                    ${getRoleName(roleId)}
                </span>
                <span class="multiplier-value">${mult}x</span>
            </div>
        `).join('');
    }
}

// Configuration Editor Functions
function showEditMode() {
    if (!dashboardData) return;
    
    const { config, user, roles } = dashboardData;
    
    // Check if user is staff and in guild
    if (!user.isStaff || !user.isInGuild) {
        if (!user.isInGuild) {
            alert('You need to be in the server to edit configuration.');
        } else {
            alert('You need the Staff role to edit configuration.');
        }
        return;
    }
    
    // Set basic values
    document.getElementById('cooldownInput').value = config.COOLDOWN;
    document.getElementById('curveBase').value = config.XP_CURVE.base;
    document.getElementById('curveSquare').value = config.XP_CURVE.square;
    document.getElementById('curveLinear').value = config.XP_CURVE.linear;
    document.getElementById('curveDivisor').value = config.XP_CURVE.divisor;
    document.getElementById('randomXpMin').value = config.RANDOM_XP.min;
    document.getElementById('randomXpMax').value = config.RANDOM_XP.max;
    
    // Load role rewards
    loadRoleRewardsEditor(config.ROLE_REWARDS, roles);
    
    // Load multipliers
    loadMultipliersEditor(config.MULTIPLIERS, roles);
    
    document.getElementById('displayMode').style.display = 'none';
    document.getElementById('editMode').style.display = 'block';
}

function loadRoleRewardsEditor(roleRewards, roles) {
    const container = document.getElementById('roleRewardsEditor');
    container.innerHTML = '';
    roleRewardCounter = 0;
    
    Object.entries(roleRewards).forEach(([level, roleId]) => {
        addRoleRewardEntry(level, roleId);
    });
}

function loadMultipliersEditor(multipliers, roles) {
    const container = document.getElementById('multipliersEditor');
    container.innerHTML = '';
    multiplierCounter = 0;
    
    Object.entries(multipliers).forEach(([roleId, multiplier]) => {
        addMultiplierEntry(roleId, multiplier);
    });
}

function addRoleReward() {
    addRoleRewardEntry('', '');
}

function addRoleRewardEntry(level = '', roleId = '') {
    const container = document.getElementById('roleRewardsEditor');
    const id = `reward-${roleRewardCounter++}`;
    
    const entry = document.createElement('div');
    entry.className = 'reward-entry';
    entry.innerHTML = `
        <input type="number" class="form-input" placeholder="Level" min="1" max="1000" value="${level}" onchange="validateRoleReward(this)">
        <select class="form-select" onchange="validateRoleReward(this)">
            <option value="">Select a role...</option>
            ${generateRoleOptions(roleId)}
        </select>
        <div class="entry-actions">
            <button type="button" onclick="removeEntry(this)" class="btn btn-danger btn-small">Remove</button>
        </div>
    `;
    
    container.appendChild(entry);
}

function addMultiplier() {
    addMultiplierEntry('', '');
}

function addMultiplierEntry(roleId = '', multiplier = '') {
    const container = document.getElementById('multipliersEditor');
    const id = `multiplier-${multiplierCounter++}`;
    
    const entry = document.createElement('div');
    entry.className = 'multiplier-entry';
    entry.innerHTML = `
        <select class="form-select" onchange="validateMultiplier(this)">
            <option value="">Select a role...</option>
            ${generateRoleOptions(roleId)}
        </select>
        <input type="number" class="form-input" placeholder="Multiplier" min="1" max="10" step="0.01" value="${multiplier}" onchange="validateMultiplier(this)">
        <div class="entry-actions">
            <button type="button" onclick="removeEntry(this)" class="btn btn-danger btn-small">Remove</button>
        </div>
    `;
    
    container.appendChild(entry);
}

function generateRoleOptions(selectedRoleId = '') {
    if (!dashboardData || !dashboardData.roles) return '';
    
    return Object.entries(dashboardData.roles)
        .map(([roleId, role]) => 
            `<option value="${roleId}" ${roleId === selectedRoleId ? 'selected' : ''}>
                ${role.name}
            </option>`
        )
        .join('');
}

function validateRoleReward(element) {
    const entry = element.closest('.reward-entry');
    const levelInput = entry.querySelector('input[type="number"]');
    const roleSelect = entry.querySelector('select');
    
    // Basic validation
    if (levelInput.value && roleSelect.value) {
        levelInput.style.borderColor = '';
        roleSelect.style.borderColor = '';
    } else {
        levelInput.style.borderColor = '#ef4444';
        roleSelect.style.borderColor = '#ef4444';
    }
}

function validateMultiplier(element) {
    const entry = element.closest('.multiplier-entry');
    const roleSelect = entry.querySelector('select');
    const multiplierInput = entry.querySelector('input[type="number"]');
    
    // Basic validation
    if (roleSelect.value && multiplierInput.value) {
        roleSelect.style.borderColor = '';
        multiplierInput.style.borderColor = '';
    } else {
        roleSelect.style.borderColor = '#ef4444';
        multiplierInput.style.borderColor = '#ef4444';
    }
}

function removeEntry(button) {
    const entry = button.closest('.reward-entry, .multiplier-entry');
    entry.remove();
}

function collectFormData() {
    // Collect role rewards
    const roleRewards = {};
    const rewardEntries = document.querySelectorAll('.reward-entry');
    rewardEntries.forEach(entry => {
        const levelInput = entry.querySelector('input[type="number"]');
        const roleSelect = entry.querySelector('select');
        
        if (levelInput.value && roleSelect.value) {
            roleRewards[levelInput.value] = roleSelect.value;
        }
    });
    
    // Collect multipliers
    const multipliers = {};
    const multiplierEntries = document.querySelectorAll('.multiplier-entry');
    multiplierEntries.forEach(entry => {
        const roleSelect = entry.querySelector('select');
        const multiplierInput = entry.querySelector('input[type="number"]');
        
        if (roleSelect.value && multiplierInput.value) {
            multipliers[roleSelect.value] = parseFloat(multiplierInput.value);
        }
    });
    
    return {
        COOLDOWN: parseInt(document.getElementById('cooldownInput').value),
        ROLE_REWARDS: roleRewards,
        MULTIPLIERS: multipliers,
        XP_CURVE: {
            base: parseFloat(document.getElementById('curveBase').value),
            square: parseFloat(document.getElementById('curveSquare').value),
            linear: parseFloat(document.getElementById('curveLinear').value),
            divisor: parseFloat(document.getElementById('curveDivisor').value)
        },
        RANDOM_XP: {
            min: parseInt(document.getElementById('randomXpMin').value),
            max: parseInt(document.getElementById('randomXpMax').value)
        }
    };
}

async function saveConfig(event) {
    event.preventDefault();
    
    if (!dashboardData) return;
    
    const { user } = dashboardData;
    if (!user.isStaff || !user.isInGuild) {
        alert('You do not have permission to edit configuration.');
        return;
    }
    
    try {
        const formData = collectFormData();
        
        // Validate form data
        if (Object.keys(formData.ROLE_REWARDS).length === 0) {
            alert('Please add at least one role reward.');
            return;
        }
        
        if (Object.keys(formData.MULTIPLIERS).length === 0) {
            alert('Please add at least one multiplier.');
            return;
        }
        
        if (formData.RANDOM_XP.min >= formData.RANDOM_XP.max) {
            alert('Minimum XP must be less than maximum XP.');
            return;
        }
        
        const response = await fetch('/lacie/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save configuration');
        }
        
        const result = await response.json();
        dashboardData.config = result.config;
        
        renderConfig(result.config, dashboardData.roles);
        
        // Update stats
        const totalRolesElem = document.getElementById('totalRoles');
        const multiplierRolesElem = document.getElementById('multiplierRoles');
        
        if (totalRolesElem) totalRolesElem.textContent = Object.keys(result.config.ROLE_REWARDS).length;
        if (multiplierRolesElem) multiplierRolesElem.textContent = Object.keys(result.config.MULTIPLIERS).length;
        
        cancelEdit();
        
        // Show success message
        const displayMode = document.getElementById('displayMode');
        if (displayMode) {
            const successMsg = document.createElement('div');
            successMsg.className = 'success-message';
            successMsg.textContent = '✅ Configuration saved successfully! Bot will use new settings immediately.';
            displayMode.insertBefore(successMsg, displayMode.firstChild);
            setTimeout(() => successMsg.remove(), 4000);
        }
        
    } catch (error) {
        alert('Error saving configuration: ' + error.message);
    }
}

function cancelEdit() {
    document.getElementById('displayMode').style.display = 'block';
    document.getElementById('editMode').style.display = 'none';
}

// User Rank Functions
async function viewUserRank(userId) {
    if (!dashboardData) return;

    const { user } = dashboardData;

    if (!user.isInGuild) {
        alert('You need to be in the server to view detailed user rank information.');
        return;
    }

    try {
        console.log(`Fetching rank for user: ${userId}`);
        const response = await fetch(`/lacie/api/user/${userId}/rank`, {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 403) {
                alert('You need to be in the server to view detailed user rank information.');
                return;
            }
            throw new Error(`Server returned ${response.status}`);
        }

        const rankData = await response.json();

        // Determine which leaderboard type to show
        const dataToShow = currentLeaderboardType === 'annual' ? rankData.annual : rankData.lifetime;

        // Attach user info
        dataToShow.user = rankData.user;

        showUserRankModal(dataToShow);

    } catch (error) {
        console.error('Error fetching user rank:', error);
        alert('Error loading user rank information: ' + error.message);
    }
}

function showUserRankModal(rankData) {
    if (!rankData.user) {
        alert('User data not available');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'userRankModal';
    modal.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%; 
        background: rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:1000;
    `;

    const user = rankData.user;
    const level = rankData.level || 0;
    const xp = rankData.xp || 0;
    const progressPercent = rankData.progress_percent || 0;
    const rank = rankData.rank || 'N/A';
    const totalUsers = rankData.total_users || 'N/A';
    const multiplier = rankData.multiplier || 1;
    const multiplierRole = rankData.multiplier_role || '';

    // Use Discord CDN for modal (real-time data)
    const avatarUrl = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : `https://via.placeholder.com/128?text=${user.username.charAt(0)}`;

    modal.innerHTML = `
        <div style="background:#1f1f1f; padding:2rem; border-radius:12px; width:400px; color:white; text-align:center; position:relative;">
            <button id="closeModal" style="position:absolute; top:10px; right:10px; background:none; border:none; font-size:1.5rem; color:white; cursor:pointer;">×</button>
            <img src="${avatarUrl}" alt="${user.display_name}" style="border-radius:50%; width:80px; height:80px; margin-bottom:1rem;">
            <h2 style="margin:0 0 0.5rem 0;">${user.display_name}</h2>
            <p>Level: ${level}</p>
            <p>XP: ${xp.toLocaleString()} (${progressPercent.toFixed(1)}% to next level)</p>
            <p>Rank: #${rank} / ${totalUsers}</p>
            <p>Multiplier: ${multiplier}x ${multiplierRole}</p>
            <div style="margin-top:1rem;">
                <div style="background:#333; height:10px; border-radius:5px; overflow:hidden;">
                    <div style="width:${progressPercent}%; background:#5865F2; height:10px;"></div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = document.getElementById('closeModal');
    if (closeModal) {
        closeModal.addEventListener('click', () => modal.remove());
    }
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function refreshCache() {
    if (!dashboardData || !dashboardData.user) {
        alert('User data not available');
        return;
    }

    const { user } = dashboardData;

    // Check if user has permission
    if (!user.isStaff || !user.isInGuild) {
        alert('You need the Staff role to refresh the user cache.');
        return;
    }

    // Confirm action
    if (!confirm('This will refresh all user data and avatars from Discord. This may take several minutes depending on the number of users. Continue?')) {
        return;
    }

    const btn = document.getElementById('refreshCacheBtn');
    const originalText = btn.innerHTML;

    try {
        // Disable button and show loading state
        btn.disabled = true;
        btn.innerHTML = '⏳ Refreshing...';

        const response = await fetch('/lacie/api/refresh-cache', {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to refresh cache');
        }

        const result = await response.json();
        
        // Show success message
        alert('✅ Cache refresh started successfully!\n\nThis will take a few minutes to complete. The dashboard will automatically use the updated data on the next page load.');

        // Reset button
        btn.disabled = false;
        btn.innerHTML = originalText;

    } catch (error) {
        console.error('Error refreshing cache:', error);
        alert('❌ Error refreshing cache: ' + error.message);
        
        // Reset button
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// User Info Functions
function updateUserInfo() {
    if (!dashboardData || !dashboardData.user) return;
    
    const user = dashboardData.user;
    
    // For authenticated user, still use Discord CDN as it's always fresh
    const getAvatarHtml = (size, className) => {
        if (user.avatar) {
            return `<img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}" alt="${user.username}" class="${className}">`;
        } else {
            return `<div class="${className}-placeholder">${user.username.charAt(0)}</div>`;
        }
    };
    
    // Update sidebar
    const sidebarAvatarDiv = document.getElementById('sidebarUserAvatar');
    const sidebarUserName = document.getElementById('sidebarUserName');
    
    if (sidebarAvatarDiv) {
        sidebarAvatarDiv.innerHTML = getAvatarHtml(32, 'sidebar-avatar');
    }
    
    if (sidebarUserName) {
        sidebarUserName.textContent = user.username;
    }
    
    // Update stats page header
    const statsAvatarDiv = document.getElementById('userAvatar');
    const statsUserName = document.getElementById('userName');
    
    if (statsAvatarDiv) {
        statsAvatarDiv.innerHTML = getAvatarHtml(128, 'avatar');
    }
    
    if (statsUserName) {
        let statusText = `Welcome, ${user.username}!`;
        if (!user.isInGuild) {
            statusText += ' (Not in server - view only)';
        }
        statsUserName.textContent = statusText;
    }
    
    // Update XP page header
    const xpAvatarDiv = document.getElementById('xpUserAvatar');
    const xpUserName = document.getElementById('xpUserName');
    
    if (xpAvatarDiv) {
        xpAvatarDiv.innerHTML = getAvatarHtml(128, 'avatar');
    }
    
    if (xpUserName) {
        let statusText = `Welcome, ${user.username}!`;
        if (!user.isInGuild) {
            statusText += ' (Not in server - view only)';
        }
        xpUserName.textContent = statusText;
    }
}

function renderXPDashboard() {
    if (!dashboardData) return;
    
    const { config, roles, lifetimeUsers, annualUsers } = dashboardData;
    
    // Update XP page stats
    const xpStats = {
        'totalRoles': Object.keys(config.ROLE_REWARDS).length,
        'multiplierRoles': Object.keys(config.MULTIPLIERS).length,
        'topLifetimeXP': lifetimeUsers[0]?.xp.toLocaleString() || '0',
        'topAnnualXP': annualUsers[0]?.xp.toLocaleString() || '0'
    };
    
    Object.entries(xpStats).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
    
    // Initialize leaderboard if on XP page
    if (document.querySelector('.leaderboard-tabs')) {
        initLeaderboardTabs();
        initPagination();
        renderCurrentLeaderboard();
    }
    
    // Render config if on XP page
    if (document.getElementById('displayMode')) {
        renderConfig(config, roles);
        
        // Show/hide buttons based on permissions
        const editButton = document.querySelector('#displayMode .btn-primary');
        const refreshCacheBtn = document.getElementById('refreshCacheBtn');
        
        if (dashboardData.user.isStaff && dashboardData.user.isInGuild) {
            // User is staff and in guild - show both buttons
            if (editButton) editButton.style.display = 'inline-block';
            if (refreshCacheBtn) refreshCacheBtn.style.display = 'inline-block';
        } else {
            // Hide edit and refresh buttons
            if (editButton) editButton.style.display = 'none';
            if (refreshCacheBtn) refreshCacheBtn.style.display = 'none';
            
            // Show message about permissions
            const configCard = document.querySelector('.right-column .card');
            if (configCard && !dashboardData.user.isInGuild) {
                const message = document.createElement('div');
                message.innerHTML = '<p style="color: #a1a1aa; font-size: 0.875rem; text-align: center; margin-top: 1rem;">Join the server and have Staff role to edit configuration</p>';
                configCard.appendChild(message);
            }
        }
    }
}

// Main Dashboard Loader
async function loadDashboard() {
    try {
        // Check if user is authenticated first
        const isAuthenticated = await checkAuthStatus();
        
        if (!isAuthenticated) {
            const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/lacie/login?returnTo=${returnTo}`;
            return;
        }

        console.log('Fetching dashboard data...');
        const response = await fetch('/lacie/api/data', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `/lacie/login?returnTo=${returnTo}`;
                return;
            }
            throw new Error('Failed to load dashboard data: ' + response.status);
        }
        
        dashboardData = await response.json();
        console.log('Dashboard data loaded successfully');
        
        // Initialize navigation
        initNavigation();
        
        // Update user info (always available)
        updateUserInfo();
        
        // Load stats data for the landing page
        await loadStatsData();
        
        // Render XP dashboard data
        renderXPDashboard();
        
        // Show the app
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.innerHTML = `
                <div style="text-align: center;">
                    <p style="color: #ef4444;">Error loading dashboard: ${error.message}</p>
                    <p style="color: #a1a1aa; font-size: 0.875rem; margin-top: 0.5rem;">
                        If this persists, try logging out and back in.
                    </p>
                    <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
                        <button onclick="location.reload()" class="btn btn-primary">Retry</button>
                        <button onclick="window.location.href='/lacie/logout'" class="btn btn-secondary">Logout</button>
                    </div>
                </div>
            `;
        }
    }
}

// Load dashboard on page load
loadDashboard();