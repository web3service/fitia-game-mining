// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    MINING: "0xb7555D092b0B30D30552502f8a2674D48601b10F", 
    FTA: "0x535bBe393D64a60E14B731b7350675792d501623", 
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 
    CHAIN_ID: 137,
    //logos
    LOGO_USDT: "https://cryptologos.cc/logos/tether-usdt-logo.png",
    LOGO_FTA: "https://i.ibb.co/vvz2DDK5/20260207-190817.webp"
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
    "function setReferrer(address)",
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

class Application {
    constructor() {
        this.provider = null; this.signer = null; this.contracts = {}; this.user = null;
        this.currentRate = 0; this.payMode = 'USDT'; this.swapDirection = 'USDT_TO_FTA';
        this.ftaDecimals = 18; this.currentMultiplier = 1000000000000000000n;
        this.currentRealPower = 0; this.pendingBalance = 0;    
        this.miningTimer = null; this.storageKey = "fitia_last_claim_time_v2"; 
        this.shopData = []; this.isLoadingShop = false; 
        this.vizContext = null; this.vizBars = [];
        // Ajouts pour les états des jeux
        this.wheelAngle = 0;
        this.wheelInterval = null;
        this.isSpinning = false;
        this.wheelCtx = null;
    }

    async init() {
        if (window.ethereum) {
            this.provider = new ethers.BrowserProvider(window.ethereum);
            window.ethereum.on('accountsChanged', () => window.location.reload());
            window.ethereum.on('chainChanged', () => window.location.reload());
        } else { this.showToast("Installez MetaMask", true); }
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

            try { this.ftaDecimals = await this.contracts.fta.decimals(); } catch(e) { this.ftaDecimals = 18; }

            document.getElementById('btn-connect').classList.add('hidden');
            document.getElementById('wallet-status').classList.remove('hidden');
            document.getElementById('addr-display').innerText = this.user.slice(0,6) + "..." + this.user.slice(38);

            this.checkReferral();
            document.getElementById('ref-link').value = window.location.origin + "?ref=" + this.user;

            // --- AJOUT : CHARGEMENT DU LOGO FTA ---
            const ftaLogoEl = document.getElementById('logo-fta-bal');
            if(ftaLogoEl) ftaLogoEl.src = CONFIG.LOGO_FTA;
            // --------------------------------------

            if (!localStorage.getItem(this.storageKey)) { localStorage.setItem(this.storageKey, Math.floor(Date.now() / 1000)); }

            await this.updateData();
            setInterval(() => this.updateData(), 5000);
            this.initVisualizer();
            window.addEventListener('resize', () => this.resizeCanvas());
            
            // Initialisation visuelle de la roue
            this.initWheel();

        } catch (e) { this.showToast("Erreur connexion", true); console.error(e); }
        this.setLoader(false);
    }

    async switchNetwork() {
        try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
        } catch (e) {
             if (e.code === 4902) {
                await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com/'], blockExplorerUrls: ['https://polygonscan.com/'] }] });
            }
        }
    }
    
    resizeCanvas() {
        if(this.vizContext) {
            const canvas = this.vizContext.canvas;
            canvas.width = canvas.offsetWidth * 2;
            canvas.height = canvas.offsetHeight * 2;
        }
    }

    async updateData() {
        if (!this.user) return;
        try {
            const rawPower = await this.contracts.mining.getActivePower(this.user);
            try { this.currentMultiplier = await this.contracts.mining.difficultyMultiplier(); } catch(e) { this.currentMultiplier = 1000000000000000000n; }

            const realPowerBN = (rawPower * this.currentMultiplier) / 1000000000000000000n;
            this.currentRealPower = parseFloat(ethers.formatUnits(realPowerBN, 8)); 

            const lastClaim = parseInt(localStorage.getItem(this.storageKey));
            const timePassed = Math.floor(Date.now() / 1000) - lastClaim;
            
            if (this.currentRealPower > 0) {
                if (!this.miningTimer) { this.pendingBalance = this.currentRealPower * timePassed; document.getElementById('val-pending').innerText = this.pendingBalance.toFixed(5); }
                document.getElementById('viz-status').innerText = "MINAGE ACTIF"; document.getElementById('viz-status').style.color = "var(--primary)";
                this.updateVisualizerIntensity(this.currentRealPower);
                if (!this.miningTimer) this.startMiningCounter();
            } else {
                this.stopMiningCounter();
                document.getElementById('viz-status').innerText = "AUCUNE MACHINE"; document.getElementById('viz-status').style.color = "#666";
                this.pendingBalance = 0; document.getElementById('val-pending').innerText = "0.00000";
            }

            document.getElementById('val-power').innerText = this.currentRealPower.toFixed(5);

            const usdtBal = await this.contracts.usdt.balanceOf(this.user);
            const ftaBal = await this.contracts.fta.balanceOf(this.user);
            document.getElementById('bal-usdt').innerText = parseFloat(ethers.formatUnits(usdtBal, 6)).toFixed(2);
            document.getElementById('bal-fta').innerText = parseFloat(ethers.formatUnits(ftaBal, this.ftaDecimals)).toFixed(2);

            const rate = await this.contracts.mining.exchangeRate();
            this.currentRate = parseFloat(ethers.formatUnits(rate, 8)); 
            document.getElementById('swap-rate').innerText = `1 USDT = ${this.currentRate.toFixed(2)} FTA`;
            
            const fromBal = this.swapDirection === 'USDT_TO_FTA' ? usdtBal : ftaBal;
            const toBal = this.swapDirection === 'USDT_TO_FTA' ? ftaBal : usdtBal;
            document.getElementById('swap-bal-from').innerText = parseFloat(ethers.formatUnits(fromBal, this.swapDirection === 'USDT_TO_FTA' ? 6 : this.ftaDecimals)).toFixed(2);
            document.getElementById('swap-bal-to').innerText = parseFloat(ethers.formatUnits(toBal, this.swapDirection === 'USDT_TO_FTA' ? this.ftaDecimals : 6)).toFixed(2);

            await this.renderShop(false);
            
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

    checkReferral() {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref && ethers.isAddress(ref)) {
            document.getElementById('bind-ref-area').style.display = 'block';
            document.getElementById('detected-ref').innerText = ref;
        }
    }

    async bindReferrer() {
        const addr = document.getElementById('detected-ref').innerText;
        if (!ethers.isAddress(addr)) return;
        this.setLoader(true, "Liaison...");
        try {
            const tx = await this.contracts.mining.setReferrer(addr);
            await tx.wait();
            this.showToast("Parrain lié avec succès !");
            document.getElementById('bind-ref-area').style.display = 'none';
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

    copyLink() {
        const val = document.getElementById('ref-link').value;
        if (!val || val === "Connectez-vous...") return this.showToast("Connectez-vous d'abord", true);
        navigator.clipboard.writeText(val);
        this.showToast("Lien copié !");
    }

    setPayMode(mode) {
        this.payMode = mode;
        document.getElementById('btn-pay-usdt').classList.toggle('active', mode === 'USDT');
        document.getElementById('btn-pay-fta').classList.toggle('active', mode === 'FTA');
        this.renderShop(false);
    }

    async renderShop(forceFetch = false) {
        if (this.isLoadingShop) return;
        const container = document.getElementById('shop-list');
        
        if (this.shopData.length > 0 && !forceFetch) {
            this._renderShopHTML(container);
            return;
        }

        this.isLoadingShop = true;
        try {
            const count = await this.contracts.mining.getMachineCount();
            const promises = [];
            for(let i=0; i<count; i++) promises.push(this.contracts.mining.machineTypes(i));
            const results = await Promise.all(promises);

            this.shopData = [];
            for(let i=0; i<count; i++) {
                const data = results[i];
                const priceUsdt = parseFloat(ethers.formatUnits(data.price, 6));
                const priceFta = priceUsdt * this.currentRate; 
                const powerBN = BigInt(data.power.toString());
                const effectivePowerBN = (powerBN * this.currentMultiplier) / 1000000000000000000n;
                const power = parseFloat(ethers.formatUnits(effectivePowerBN, 8)); 

                this.shopData.push({ price: priceUsdt, power: power, priceFta: priceFta });
            }
            this._renderShopHTML(container);
        } catch(e) { console.error("Shop Error", e); }
        this.isLoadingShop = false;
    }

    _renderShopHTML(container) {
        container.innerHTML = ''; 
        for(let i=0; i<this.shopData.length; i++) {
            const data = this.shopData[i];
            const div = document.createElement('div');
            div.className = 'rig-item';
            div.innerHTML = `
                <div>
                    <span class="rig-name">RIG ${i+1}</span>
                    <span class="rig-power">${data.power.toFixed(5)} FTA/s</span>
                </div>
                <div>
                    <span class="rig-price">${this.payMode === 'USDT' ? data.price.toFixed(2) + ' $' : data.priceFta.toFixed(2) + ' FTA'}</span>
                    <button class="btn-primary" style="padding:8px; font-size:0.8rem" onclick="App.buyMachine(${i})">ACHETER</button>
                </div>
            `;
            container.appendChild(div);
        }
    }

    async buyMachine(id) {
        if (!this.user) return this.connect();
        this.setLoader(true, "Transaction...");
        try {
            const m = await this.contracts.mining.machineTypes(id);
            if (this.payMode === 'USDT') {
                const allow = await this.contracts.usdt.allowance(this.user, CONFIG.MINING);
                if (allow < m.price) { await (await this.contracts.usdt.approve(CONFIG.MINING, m.price)).wait(); }
                await (await this.contracts.mining.buyMachine(id)).wait();
            } else {
                const rate = await this.contracts.mining.exchangeRate();
                const ftaPrice = (m.price * rate) / 1000000n; 
                const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
                if (allow < ftaPrice) { await (await this.contracts.fta.approve(CONFIG.MINING, ftaPrice)).wait(); }
                await (await this.contracts.mining.buyMachineWithFTA(id)).wait();
            }
            this.showToast("Achat réussi !");
            this.isLoadingShop = false; 
            await this.renderShop(true);
            await this.checkMyMachines(); 
            this.updateData();
        } catch (e) { this.showError(e); }
        this.setLoader(false);
    }

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
            if (allowance < amount) { await (await tokenContract.approve(CONFIG.MINING, amount)).wait(); }
            const tx = isUsdtTo ? await this.contracts.mining.swapUsdtForFta(amount) : await this.contracts.mining.swapFtaForUsdt(amount);
            await tx.wait();
            this.showToast("Échange réussi !");
            document.getElementById('swap-from-in').value = '';
            this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

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

    showGame(id) {
        document.querySelectorAll('.game-area').forEach(el => el.classList.remove('active'));
        document.getElementById('game-' + id).classList.add('active');
        document.querySelectorAll('.game-tab').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');
    }

    // --- FONCTIONS JEUX CORRIGÉES ---

    showGameResult(elementId, message, isWin) {
        const el = document.getElementById(elementId);
        el.className = "game-result-box " + (isWin ? "win" : "lose");
        el.innerText = message;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    // WIN GO
    async playWinGo(type, choice) {
        const betVal = document.getElementById('wingo-bet').value;
        if (!betVal || betVal <= 0) return this.showToast("Mise invalide", true);
        const amount = ethers.parseUnits(betVal, this.ftaDecimals);
        
        // Désactiver boutons
        const buttons = document.querySelectorAll('#game-wingo .game-options button');
        buttons.forEach(b => b.disabled = true);
        
        // Lancer Animation IMMÉDIATEMENT
        const reel = document.getElementById('slot-reel');
        reel.classList.add('spinning');
        
        try {
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < amount) await (await this.contracts.fta.approve(CONFIG.MINING, amount)).wait();
            
            // Transaction
            const tx = await this.contracts.mining.playWinGo(amount, type, choice);
            
            // On attend la confirmation PENDANT que ça tourne
            await tx.wait();

            // Arrêt Animation
            reel.classList.remove('spinning');
            const randomNum = Math.floor(Math.random() * 10);
            const finalOffset = -80 * randomNum; 
            reel.style.transform = `translateY(${finalOffset}px)`;

            this.showGameResult('wingo-result', `Résultat: ${randomNum}\nVérifiez le contrat`, true);
            this.updateData();
        } catch(e) { 
            reel.classList.remove('spinning'); 
            reel.style.transform = 'translateY(0px)'; 
            this.showError(e); 
        }
        buttons.forEach(b => b.disabled = false);
    }

    // WHEEL
    initWheel() {
        const canvas = document.getElementById('wheel-canvas');
        if(!canvas) return;
        this.wheelCtx = canvas.getContext('2d');
        this.drawWheel(0);
    }

    drawWheel(rotation) {
        const ctx = this.wheelCtx;
        if(!ctx) return;
        const seg = ["10x", "2x", "5x", "1x", "50x", "0x", "3x", "WIN"];
        const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#1e293b", "#ec4899", "#fbbf24"];
        
        ctx.clearRect(0, 0, 300, 300);
        ctx.save();
        ctx.translate(150, 150);
        ctx.rotate(rotation);
        ctx.translate(-150, -150);

        const step = (2 * Math.PI) / seg.length;
        for(let i=0; i<seg.length; i++) {
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.arc(150, 150, 140, i * step, (i + 1) * step);
            ctx.closePath();
            ctx.fillStyle = colors[i];
            ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
            ctx.save(); ctx.translate(150, 150); ctx.rotate(i * step + step / 2);
            ctx.textAlign = "right"; ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
            ctx.fillText(seg[i], 110, 5);
            ctx.restore();
        }
        ctx.beginPath(); ctx.arc(150, 150, 20, 0, 2 * Math.PI); ctx.fillStyle = "#000"; ctx.fill();
        ctx.restore();
    }

    async spinWheel() {
        if(this.isSpinning) return;
        this.isSpinning = true;
        
        // Désactiver bouton
        const btn = document.querySelector('#game-wheel .btn-game');
        btn.disabled = true;

        // Lancer Animation IMMÉDIATEMENT
        if (this.wheelInterval) clearInterval(this.wheelInterval);
        this.wheelInterval = setInterval(() => {
            this.wheelAngle += 0.2;
            this.drawWheel(this.wheelAngle);
        }, 20);

        try {
            const price = ethers.parseUnits("100", this.ftaDecimals); 
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            
            // Transaction
            const tx = await this.contracts.mining.spinWheel();
            
            // Attendre confirmation PENDANT que ça tourne
            await tx.wait();
            
            // Arrêt smooth
            clearInterval(this.wheelInterval);
            this.wheelAngle += 5; 
            this.drawWheel(this.wheelAngle);

            this.showGameResult('wheel-result', "Roue tournée !", true);
            this.updateData();
        } catch(e) {
            clearInterval(this.wheelInterval);
            this.showError(e);
        }
        
        this.isSpinning = false;
        btn.disabled = false;
    }
    
    // FISHING
    async goFishing() {
        const line = document.getElementById('fishing-line');
        const hook = document.getElementById('fishing-hook');
        const status = document.getElementById('fishing-status');
        const btn = document.querySelector('#game-fishing .btn-game');
        btn.disabled = true;
        
        // Reset visuel
        line.style.height = '0px'; hook.style.top = '0px'; status.innerText = "Lancer...";
        
        try {
            const price = ethers.parseUnits("50", this.ftaDecimals); 
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            
            // Lancer Animation IMMÉDIATEMENT
            setTimeout(() => {
                line.style.height = '120px'; hook.style.top = '120px'; status.innerText = "Ligne lancée...";
            }, 500);

            // Transaction
            const tx = await this.contracts.mining.goFishing();
            await tx.wait();
            
            // Résultat
            status.innerText = "Ça mord !";
            hook.style.fontSize = "3rem";
            setTimeout(() => hook.style.fontSize = "2rem", 500);

            this.showGameResult('fish-result', "Pêche réussie !", true);
            this.updateData();
        } catch(e) { 
            line.style.height = '0px'; hook.style.top = '0px'; status.innerText="Erreur"; this.showError(e); 
        }
        btn.disabled = false;
    }
    
    async buyLotteryTicket() {
        this.setLoader(true, "Ticket...");
        try {
            const price = ethers.parseUnits("50", this.ftaDecimals);
            const allow = await this.contracts.fta.allowance(this.user, CONFIG.MINING);
            if (allow < price) await (await this.contracts.fta.approve(CONFIG.MINING, price)).wait();
            await (await this.contracts.mining.buyLotteryTicket()).wait();
            this.showToast("Ticket acheté !"); this.updateData();
        } catch(e) { this.showError(e); }
        this.setLoader(false);
    }

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
            const promises = [];
            for(let i=0; i<count; i++) promises.push(this.contracts.mining.getUserMachineCount(this.user, i));
            const results = await Promise.all(promises);
            let found = false;
            
            for(let i=0; i<count; i++) {
                const machineCount = results[i];
                if (machineCount > 0) {
                    found = true;
                    let powerDisplay = "N/A";
                    if (this.shopData[i]) powerDisplay = this.shopData[i].power.toFixed(5);
                    const div = document.createElement('div');
                    div.className = 'my-rig-card active';
                    div.innerHTML = `<div class="rig-info"><h4>RIG ${i+1} <span style="opacity:0.5">x${machineCount.toString()}</span></h4><p>${powerDisplay} FTA/s</p></div><span class="rig-status-badge status-active">ACTIF</span>`;
                    container.appendChild(div);
                }
            }
            noRigs.style.display = found ? 'none' : 'block';
        } catch(e) { console.error("Erreur chargement machines", e); }
    }
    
    initVisualizer() {
        const canvas = document.getElementById('mining-canvas');
        if (!canvas) return;
        this.resizeCanvas();
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
        if(msg.includes("Invalid bet amount")) msg = "Mise invalide";
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