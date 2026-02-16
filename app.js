// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    MINING: "0xb7555D092b0B30D30552502f8a2674D48601b10F", // Votre contrat Minage
    FTA: "0x535bBe393D64a60E14B731b7350675792d501623", // Votre contrat Token FTA
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT Polygon
    CHAIN_ID: 137
};

const MINING_ABI = [
    "function getActivePower(address) view returns (uint256)",
    "function getMachineCount() view returns (uint256)",
    "function getUserMachineCount(address, uint256) view returns (uint256)",
    "function machineTypes(uint256) view returns (uint256 price, uint256 power)",
    "function difficultyMultiplier() view returns (uint256)",
    "function exchangeRate() view returns (uint256)",
    "function getWheelJackpot() view returns (uint256)",
    "function getLotteryPool() view returns (uint256)",
    "function buyMachine(uint256 typeId)",
    "function buyMachineWithFTA(uint256 typeId)",
    "function claimRewards()",
    "function swapUsdtForFta(uint256 amount)",
    "function swapFtaForUsdt(uint256 amount)",
    "function playWinGo(uint256 amount, uint8 betType, uint8 choice)",
    "function spinWheel()",
    "function goFishing()",
    "function buyLotteryTicket()"
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)"
];

// ==========================================
// LOGIQUE
// ==========================================
class Application {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contracts = {};
        this.user = null;
        this.currentRate = 0;
        this.payMode = 'USDT'; 
        this.swapDirection = 'USDT_TO_FTA';
        this.ftaDecimals = 18;
        this.currentRealPower = 0;
        this.pendingBalance = 0;    
        this.miningTimer = null;
        this.storageKey = "fitia_last_claim_time";
        this.shopData = [];
        this.isLoadingShop = false; // VERROU ANTI-CLIGNOTEMENT
        this.vizContext = null;
        this.vizBars = [];
    }

    async init() {
        if (window.ethereum) {
            this.provider = new ethers.BrowserProvider(window.ethereum);
            window.ethereum.on('accountsChanged', () => window.location.reload());
            window.ethereum.on('chainChanged', () => window.location.reload());
        } else {
            this.showToast("Installez MetaMask", true);
        }
    }

    async connect() {
        if (!window.ethereum) return;
        this.setLoader(true, "Connexion...");
        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.signer = await this.provider.getSigner();
            this.user = await this.signer.getAddress();

            const network = await this.provider.getNetwork();
            if (Number(network.chainId) !== CONFIG.CHAIN_ID) await this.switchNetwork();

            this.contracts.usdt = new ethers.Contract(CONFIG.USDT, ERC20_ABI, this.signer);
            this.contracts.fta = new ethers.Contract(CONFIG.FTA, ERC20_ABI, this.signer);
            this.contracts.mining = new ethers.Contract(CONFIG.MINING, MINING_ABI, this.signer);

            // Détection auto décimales
            try { this.ftaDecimals = await this.contracts.fta.decimals(); } catch(e) { this.ftaDecimals = 18; }

            document.getElementById('btn-connect').classList.add('hidden');
            document.getElementById('wallet-status').classList.remove('hidden');
            document.getElementById('addr-display').innerText = this.user.slice(0,6) + "..." + this.user.slice(38);

            await this.updateData();
            setInterval(() => this.updateData(), 5000);
            this.initVisualizer();
        } catch (e) { this.showToast("Erreur connexion", true); }
        this.setLoader(false);
    }

    async switchNetwork() {
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
        } catch (e) {
             if (e.code === 4902) {
                await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com/'], blockExplorerUrls: ['https://polygonscan.com/'] }] });
            }
        }
    }

    async updateData() {
        if (!this.user) return;
        try {
            // 1. Minage
            const rawPower = await this.contracts.mining.getActivePower(this.user);
            let multiplier = 1e18;
            try { multiplier = await this.contracts.mining.difficultyMultiplier(); } catch(e) {}

            const realPowerBN = (rawPower * multiplier) / 1000000000000000000n;
            this.currentRealPower = parseFloat(ethers.formatUnits(realPowerBN, 8)); 

            let lastClaim = localStorage.getItem(this.storageKey) || Math.floor(Date.now() / 1000);
            const timePassed = Math.floor(Date.now() / 1000) - parseInt(lastClaim);
            
            if (this.currentRealPower > 0) {
                this.pendingBalance = this.currentRealPower * timePassed;
                document.getElementById('viz-status').innerText = "MINAGE ACTIF";
                document.getElementById('viz-status').style.color = "var(--primary)";
                this.updateVisualizerIntensity(this.currentRealPower);
                if (!this.miningTimer) this.startMiningCounter();
            } else {
                this.stopMiningCounter();
                document.getElementById('viz-status').innerText = "AUCUNE MACHINE";
                document.getElementById('viz-status').style.color = "#666";
            }

            document.getElementById('val-power').innerText = this.currentRealPower.toFixed(5);
            if (!this.miningTimer) document.getElementById('val-pending').innerText = this.pendingBalance.toFixed(5);

            // 2. Balances
            const usdtBal = await this.contracts.usdt.balanceOf(this.user);
            const ftaBal = await this.contracts.fta.balanceOf(this.user);
            document.getElementById('bal-usdt').innerText = parseFloat(ethers.formatUnits(usdtBal, 6)).toFixed(2);
            document.getElementById('bal-fta').innerText = parseFloat(ethers.formatUnits(ftaBal, this.ftaDecimals)).toFixed(2);

            // 3. Swap
            const rate = await this.contracts.mining.exchangeRate();
            this.currentRate = parseFloat(ethers.formatUnits(rate, 8)); 
            document.getElementById('swap-rate').innerText = `1 USDT = ${this.currentRate.toFixed(2)} FTA`;
            
            const fromBal = this.swapDirection === 'USDT_TO_FTA' ? usdtBal : ftaBal;
            const toBal = this.swapDirection === 'USDT_TO_FTA' ? ftaBal : usdtBal;
            document.getElementById('swap-bal-from').innerText = parseFloat(ethers.formatUnits(fromBal, this.swapDirection === 'USDT_TO_FTA' ? 6 : this.ftaDecimals)).toFixed(2);
            document.getElementById('swap-bal-to').innerText = parseFloat(ethers.formatUnits(toBal, this.swapDirection === 'USDT_TO_FTA' ? this.ftaDecimals : 6)).toFixed(2);

            // 4. Shop (Seulement si vide)
            await this.renderShop();
            
            // 5. Games
            try {
                document.getElementById('wheel-jackpot').innerText = parseFloat(ethers.formatUnits(await this.contracts.mining.getWheelJackpot(), this.ftaDecimals)).toFixed(2);
                document.getElementById('lottery-pot').innerText = parseFloat(ethers.formatUnits(await this.contracts.mining.getLotteryPool(), this.ftaDecimals)).toFixed(2);
            } catch(e) {}

        } catch (e) { console.error("Refresh Error", e); }
    }

    startMiningCounter() {
        if (this.miningTimer) return;
        this.miningTimer = setInterval(() => {
            if (this.currentRealPower > 0) {
                this.pendingBalance += this.currentRealPower;
                document.getElementById('val-pending').innerText = this.pendingBalance.toFixed(5);
                document.getElementById('val-pending').style.color = 'var(--primary)';
                setTimeout(() => document.getElementById('val-pending').style.color = 'var(--text)', 500);
            }
        }, 1000);
    }
    stopMiningCounter() { if (this.miningTimer) { clearInterval(this.miningTimer); this.miningTimer = null; } }

    // --- BOUTIQUE (CORRECTION CLIGNOTEMENT) ---
    setPayMode(mode) {
        this.payMode = mode;
        document.getElementById('btn-pay-usdt').classList.toggle('active', mode === 'USDT');
        document.getElementById('btn-pay-fta').classList.toggle('active', mode === 'FTA');
        this.renderShop(true); // Force refresh
    }

    async renderShop(force = false) {
        if (this.isLoadingShop) return; // Verrou actif
        if (this.shopData.length > 0 && !force) return; // Déjà chargé

        this.isLoadingShop = true; // Activation du verrou
        const container = document.getElementById('shop-list');
        try {
            const count = await this.contracts.mining.getMachineCount();
            container.innerHTML = ''; 
            this.shopData = [];

            for(let i=0; i<count; i++) {
                const data = await this.contracts.mining.machineTypes(i);
                const priceUsdt = parseFloat(ethers.formatUnits(data.price, 6));
                const priceFta = priceUsdt * this.currentRate; 
                const power = parseFloat(ethers.formatUnits(data.power, 8)); 

                this.shopData.push({ price: priceUsdt, power: power });

                const div = document.createElement('div');
                div.className = 'rig-item';
                div.innerHTML = `
                    <div>
                        <span class="rig-name">RIG ${i+1}</span>
                        <span class="rig-power">${power.toFixed(5)} FTA/s</span>
                    </div>
                    <div>
                        <span class="rig-price">${this.payMode === 'USDT' ? priceUsdt.toFixed(2) + ' $' : priceFta.toFixed(2) + ' FTA'}</span>
                        <button class="btn-primary" style="padding:10px; font-size:0.8rem" onclick="App.buyMachine(${i})">ACHETER</button>
                    </div>
                `;
                container.appendChild(div);
            }
        } catch(e) {}
        this.isLoadingShop = false; // Libération
    }

    async buyMachine(id) {
        if (!this.user) return this.connect();
        this.setLoader(true, "Transaction...");
        try {
            const m = await this.contracts.mining.machineTypes(id);
            
            if (this.payMode === 'USDT') {
                const allow = await this.contracts.usdt.allowance(this.user, CONFIG.MINING);
                if (allow < m.price) {
                    this.setLoader(true, "Approve USDT...");
                    await (await this.contracts.usdt.approve(CONFIG.MINING, m.price)).wait();
                }
                this.setLoader(true, "Achat...");
                await (await this.contracts.mining.buyMachine(id)).wait();
            } else {
                const rate = await this.contracts.mining.exchangeRate();
                const ftaPrice = (m.price * rate) / 1000000n; 
                const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
                if (allow < ftaPrice) {
                    this.setLoader(true, "Approve FTA...");
                    await (await this.contracts.fta.approve(CONFIG.MINING, ftaPrice)).wait();
                }
                this.setLoader(true, "Achat...");
                await (await this.contracts.mining.buyMachineWithFTA(id)).wait();
            }
            this.showToast("Achat réussi !");
            localStorage.setItem(this.storageKey, Math.floor(Date.now() / 1000));
            this.pendingBalance = 0;
            this.renderShop(true); // Refresh boutique
            this.updateData();
        } catch (e) { this.showError(e); }
        this.setLoader(false);
    }

    // --- SWAP ---
    toggleSwap() {
        this.swapDirection = this.swapDirection === 'USDT_TO_FTA' ? 'FTA_TO_USDT' : 'USDT_TO_FTA';
        document.getElementById('token-from-display').innerText = this.swapDirection === 'USDT_TO_FTA' ? 'USDT' : 'FTA';
        document.getElementById('token-to-display').innerText = this.swapDirection === 'USDT_TO_FTA' ? 'FTA' : 'USDT';
        this.updateData();
    }
    calcSwap() {
        const val = document.getElementById('swap-from-in').value;
        if (!val) return document.getElementById('swap-to-in').value = '';
        const res = this.swapDirection === 'USDT_TO_FTA' ? val * this.currentRate : val / this.currentRate;
        document.getElementById('swap-to-in').value = res.toFixed(5);
    }
    async executeSwap() {
        const val = document.getElementById('swap-from-in').value;
        if (!val || val <= 0) return this.showToast("Montant invalide", true);
        this.setLoader(true, "Swap...");
        const isUsdtTo = this.swapDirection === 'USDT_TO_FTA';
        const decimals = isUsdtTo ? 6 : this.ftaDecimals;
        const amount = ethers.parseUnits(val, decimals);
        try {
            const tokenContract = isUsdtTo ? this.contracts.usdt : this.contracts.fta;
            const allowance = await tokenContract.allowance(this.user, CONFIG.MINING);
            if (allowance < amount) {
                this.setLoader(true, "Approve...");
                await (await tokenContract.approve(CONFIG.MINING, amount)).wait();
            }
            const tx = isUsdtTo ? await this.contracts.mining.swapUsdtForFta(amount) : await this.contracts.mining.swapFtaForUsdt(amount);
            await tx.wait();
            this.showToast("Échange réussi !");
            document.getElementById('swap-from-in').value = '';
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

    // --- CLAIM ---
    async claim() {
        if (!this.user) return;
        this.stopMiningCounter();
        this.setLoader(true, "Claim...");
        try {
            await (await this.contracts.mining.claimRewards()).wait();
            this.pendingBalance = 0;
            localStorage.setItem(this.storageKey, Math.floor(Date.now() / 1000));
            this.showToast("Gains réclamés !");
            this.updateData();
            if (this.currentRealPower > 0) this.startMiningCounter();
        } catch(e) { this.showError(e); this.startMiningCounter(); }
        this.setLoader(false);
    }

    // --- GAMES ---
    showGame(id) {
        document.querySelectorAll('.game-area').forEach(el => el.classList.remove('active'));
        document.getElementById('game-' + id).classList.add('active');
        document.querySelectorAll('.game-tab').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');
    }

    async playWinGo(type, choice) {
        const betVal = document.getElementById('wingo-bet').value;
        if (!betVal || betVal <= 0) return this.showToast("Mise invalide", true);
        const amount = ethers.parseUnits(betVal, this.ftaDecimals);
        
        this.setLoader(true, "Jeu...");
        try {
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < amount) await (await this.contracts.fta.approve(CONFIG.MINING, amount)).wait();
            await (await this.contracts.mining.playWinGo(amount, type, choice)).wait();
            this.showToast("Jeu terminé ! Vérifiez votre solde.");
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

    async spinWheel() {
        this.setLoader(true, "Roue...");
        try {
            const price = ethers.parseUnits("100", this.ftaDecimals); 
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            await (await this.contracts.mining.spinWheel()).wait();
            this.showToast("Roue tournée !");
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }
    
    async goFishing() {
        this.setLoader(true, "Pêche...");
        try {
            const price = ethers.parseUnits("50", this.ftaDecimals); 
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            await (await this.contracts.mining.goFishing()).wait();
            this.showToast("Pêche terminée !");
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }
    
    async buyLotteryTicket() {
        this.setLoader(true, "Ticket...");
        try {
            const price = ethers.parseUnits("50", this.ftaDecimals);
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            await (await this.contracts.mining.buyLotteryTicket()).wait();
            this.showToast("Ticket acheté !");
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

    // --- NAV ---
    nav(viewId) {
        document.querySelectorAll('.view').forEach(el => { el.classList.remove('active'); el.style.display = 'none'; });
        const activeView = document.getElementById('view-' + viewId);
        if(activeView) { activeView.classList.add('active'); activeView.style.display = 'block'; }
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(event && event.currentTarget) event.currentTarget.classList.add('active');
        if (viewId === 'my-rigs') this.checkMyMachines();
    }

    async checkMyMachines() {
        const container = document.getElementById('my-rigs-list');
        const noRigs = document.getElementById('no-rigs');
        container.innerHTML = '';
        if(!this.user) return;
        try {
            const count = await this.contracts.mining.getMachineCount();
            let found = false;
            for(let i=0; i<count; i++) {
                const machineCount = await this.contracts.mining.getUserMachineCount(this.user, i);
                if (machineCount > 0) {
                    found = true;
                    const power = this.shopData[i] ? this.shopData[i].power : "N/A";
                    const div = document.createElement('div');
                    div.className = 'my-rig-card active';
                    div.innerHTML = `<div class="rig-info"><h4>RIG ${i+1} <span style="opacity:0.7">x${machineCount.toString()}</span></h4><p>${power} FTA/s</p></div><span class="rig-status-badge status-active">ACTIF</span>`;
                    container.appendChild(div);
                }
            }
            noRigs.style.display = found ? 'none' : 'block';
        } catch(e) {}
    }
    
    // --- VISUALIZER ---
    initVisualizer() {
        const canvas = document.getElementById('mining-canvas');
        if (!canvas) return;
        canvas.width = canvas.offsetWidth * 2; canvas.height = canvas.offsetHeight * 2;
        this.vizContext = canvas.getContext('2d');
        this.vizBars = [];
        for(let i=0; i<20; i++) this.vizBars.push({ height: 0, targetHeight: 0 });
        this.animateVisualizer();
    }
    updateVisualizerIntensity(p) {
        let intensity = p > 0 ? Math.min((p * 500) + 10, 100) : 0;
        this.vizBars.forEach(bar => bar.targetHeight = (this.vizContext.canvas.height * (intensity/100)) * Math.random());
    }
    animateVisualizer() {
        if(!this.vizContext) return;
        const ctx = this.vizContext;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = "#10b981";
        const w = ctx.canvas.width / 20;
        this.vizBars.forEach((bar, i) => {
            bar.height += (bar.targetHeight - bar.height) * 0.1;
            ctx.fillRect(i * w + 2, ctx.canvas.height - bar.height, w - 4, bar.height);
            bar.targetHeight += (Math.random() - 0.5) * 10;
        });
        requestAnimationFrame(() => this.animateVisualizer());
    }

    setLoader(show, msg="Chargement...") {
        const l = document.getElementById('loader');
        document.getElementById('loader-text').innerText = msg;
        show ? l.classList.remove('hidden') : l.classList.add('hidden');
    }
    
    showError(e) {
        console.error(e);
        let msg = "Erreur inconnue";
        if(e.reason) msg = e.reason;
        else if (e.error && e.error.reason) msg = e.error.reason;
        else if (e.data && e.data.message) msg = e.data.message;
        
        if(msg.includes("Invalid bet amount")) msg = "Mise invalide ou contrat vide";
        if(msg.includes("insufficient funds")) msg = "Fonds insuffisants";
        
        this.showToast(msg, true);
    }

    showToast(msg, isError=false) {
        const div = document.createElement('div');
        div.className = 'toast';
        if (isError) div.style.borderLeftColor = 'var(--danger)';
        div.innerText = msg;
        document.getElementById('toast-container').appendChild(div);
        setTimeout(() => div.remove(), 4000);
    }
}

const App = new Application();
window.onload = () => App.init();