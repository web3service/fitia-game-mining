// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    MINING: "0xb7555D092b0B30D30552502f8a2674D48601b10F", 
    FTA: "0x535bBe393D64a60E14B731b7350675792d501623", 
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 
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

// ==========================================
// LOGIQUE
// ==========================================
class Application {
    constructor() {
        this.p=null; this.s=null; this.c={}; this.u=null;
        this.r=0; this.m='USDT'; this.d='USDT_TO_FTA';
        this.dec=18; this.mul=1000000000000000000n;
        this.pow=0; this.bal=0;    
        this.tmr=null; this.key="fitia_last_claim_time_v2";
        this.shop=[]; this.load=false; 
        this.vCtx=null; this.vBars=[];
        // Wheel State
        this.wheelState = { angle: 0, ctx: null };
    }

    async init() {
        if (window.ethereum) {
            this.p = new ethers.BrowserProvider(window.ethereum);
            window.ethereum.on('accountsChanged', () => location.reload());
            window.ethereum.on('chainChanged', () => location.reload());
        }
    }

    async connect() {
        if (!window.ethereum) return;
        this.setL(true,"Connexion...");
        try {
            await ethereum.request({method:'eth_requestAccounts'});
            this.s=await this.p.getSigner(); this.u=await this.s.getAddress();
            if((await this.p.getNetwork()).chainId!=CONFIG.CHAIN_ID) await this.sw();
            this.c.u=new ethers.Contract(CONFIG.USDT,ERC20_ABI,this.s);
            this.c.f=new ethers.Contract(CONFIG.FTA,ERC20_ABI,this.s);
            this.c.m=new ethers.Contract(CONFIG.MINING,MINING_ABI,this.s);
            try{this.dec=await this.c.f.decimals();}catch{}
            
            // Init LocalStorage
            if(!localStorage.getItem(this.key)) localStorage.setItem(this.key, Math.floor(Date.now()/1000));

            $('#btn-connect').classList.add('hidden');
            $('#wallet-status').classList.remove('hidden');
            $('#addr-display').innerText=this.u.slice(0,6)+"..."+this.u.slice(38);

            this.chkRef(); $('#ref-link').value=location.origin+"?ref="+this.u;
            await this.upd(); setInterval(()=>this.upd(),5000);
            this.initV();
            this.initWheel(); // Init Wheel Canvas
        } catch(e) { console.error(e); this.t("Erreur",1); }
        this.setL(false);
    }

    async sw(){try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x89'}]});}catch(e){if(e.code==4902)await ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x89',chainName:'Polygon',nativeCurrency:{name:'MATIC',symbol:'MATIC',decimals:18},rpcUrls:['https://polygon-rpc.com/'],blockExplorerUrls:['https://polygonscan.com/']}]})}}
    
    async upd() {
        if(!this.u)return;
        try {
            let p=await this.c.m.getActivePower(this.u);
            try{this.mul=await this.c.m.difficultyMultiplier();}catch{}
            let bn=(p*this.mul)/1000000000000000000n;
            this.pow=parseFloat(ethers.formatUnits(bn,8));
            
            const lastClaim=parseInt(localStorage.getItem(this.key));
            const timePassed=Math.floor(Date.now()/1000)-lastClaim;
            
            if(this.pow>0){
                if(!this.tmr) this.bal=this.pow*timePassed; // Calc pending
                $('#viz-status').innerText="MINAGE ACTIF"; $('#viz-status').style.color="var(--primary)";
                this.updV(this.pow); if(!this.tmr)this.str();
            } else {
                this.stp(); $('#viz-status').innerText="AUCUNE MACHINE"; $('#viz-status').style.color="#666";
                this.bal=0;
            }

            $('#val-power').innerText=this.pow.toFixed(5);
            if(!this.tmr)$('#val-pending').innerText=this.bal.toFixed(5);

            let uBal=await this.c.u.balanceOf(this.u);
            let fBal=await this.c.f.balanceOf(this.u);
            $('#bal-usdt').innerText=parseFloat(ethers.formatUnits(uBal,6)).toFixed(2);
            $('#bal-fta').innerText=parseFloat(ethers.formatUnits(fBal,this.dec)).toFixed(2);

            let rate=await this.c.m.exchangeRate(); this.r=parseFloat(ethers.formatUnits(rate,8)); 
            $('#swap-rate').innerText=`1 USDT = ${this.r.toFixed(2)} FTA`;
            
            let fB=this.d=='USDT_TO_FTA'?uBal:fBal; let tB=this.d=='USDT_TO_FTA'?fBal:uBal;
            $('#swap-bal-from').innerText=parseFloat(ethers.formatUnits(fB,this.d=='USDT_TO_FTA'?6:this.dec)).toFixed(2);
            $('#swap-bal-to').innerText=parseFloat(ethers.formatUnits(tB,this.d=='USDT_TO_FTA'?this.dec:6)).toFixed(2);

            await this.rSh(false);
            try{$('#wheel-jackpot').innerText=parseFloat(ethers.formatUnits(await this.c.m.getWheelJackpot(),this.dec)).toFixed(2);$('#lottery-pot').innerText=parseFloat(ethers.formatUnits(await this.c.m.getLotteryPool(),this.dec)).toFixed(2);}catch{}
        } catch(e) { console.error("Refresh Error",e); }
    }

    str(){if(this.tmr)return;this.tmr=setInterval(()=>{if(this.pow>0){this.bal+=this.pow;$('#val-pending').innerText=this.bal.toFixed(5);$('#val-pending').style.color='var(--primary)';setTimeout(()=>$('#val-pending').style.color='var(--text)',500);}},1000);}
    stp(){if(this.tmr){clearInterval(this.tmr);this.tmr=null;}}

    chkRef(){let p=new URLSearchParams(location.search).get('ref');if(p&&ethers.isAddress(p)){$('#detected-ref').innerText=p;$('#bind-ref-area').style.display='block';}}
    async bindReferrer(){let a=$('#detected-ref').innerText;if(!ethers.isAddress(a))return;this.setL(true,"Liaison...");try{await(await this.c.m.setReferrer(a)).wait();this.t("Parrain lié !");$('#bind-ref-area').style.display='none';}catch(e){this.shE(e);}this.setL(false);}
    copyLink(){let v=$('#ref-link').value;if(!v||v=="Connectez-vous...")return this.t("Connectez-vous d'abord",1);navigator.clipboard.writeText(v);this.t("Lien copié !");}

    setM(m){this.m=m;$('#btn-pay-usdt').classList.toggle('active',m=='USDT');$('#btn-pay-fta').classList.toggle('active',m=='FTA');this.rSh(false);}
    async rSh(f){ if(this.load)return; let c=$('#shop-list'); if(this.shop.length>0&&!f){this._rSh(c);return;} this.load=true; try{ let n=await this.c.m.getMachineCount(); let pr=[]; for(let i=0;i<n;i++)pr.push(this.c.m.machineTypes(i)); let res=await Promise.all(pr); this.shop=[]; for(let i=0;i<n;i++){ let d=res[i]; let pu=parseFloat(ethers.formatUnits(d.price,6)); let pf=pu*this.r; let pB=BigInt(d.power.toString()); let eB=(pB*this.mul)/1000000000000000000n; let p=parseFloat(ethers.formatUnits(eB,8)); this.shop.push({p:pu,pw:p,pf:pf}); } this._rSh(c); }catch{} this.load=false; }
    _rSh(c){ c.innerHTML=''; for(let i=0;i<this.shop.length;i++){ let d=this.shop[i]; let div=document.createElement('div'); div.className='rig-item'; div.innerHTML=`<div><span class="rig-name">RIG ${i+1}</span><span class="rig-power">${d.pw.toFixed(5)} FTA/s</span></div><div><span class="rig-price">${this.m=='USDT'?d.p.toFixed(2)+' $':d.pf.toFixed(2)+' FTA'}</span><button class="btn-primary" style="padding:8px;font-size:0.8rem" onclick="App.bM(${i})">ACHETER</button></div>`; c.appendChild(div); }}
    
    async bM(id){ if(!this.u)return this.connect(); this.setL(true,"Transaction..."); try{ let m=await this.c.m.machineTypes(id); if(this.m=='USDT'){ let a=await this.c.u.allowance(this.u,CONFIG.MINING); if(a<m.price)await(await this.c.u.approve(CONFIG.MINING,m.price)).wait(); await(await this.c.m.buyMachine(id)).wait(); } else { let r=await this.c.m.exchangeRate(); let fp=(m.price*r)/1000000n; let a=await this.c.f.allowance(this.u,CONFIG.MINING); if(a<fp)await(await this.c.f.approve(CONFIG.MINING,fp)).wait(); await(await this.c.m.buyMachineWithFTA(id)).wait(); } this.t("Achat réussi !"); this.load=false; await this.rSh(true); await this.chk(); this.upd(); }catch(e){this.shE(e);} this.setL(false); }

    tog(){this.d=this.d=='USDT_TO_FTA'?'FTA_TO_USDT':'USDT_TO_FTA';$('#token-from-display').innerText=this.d=='USDT_TO_FTA'?'USDT':'FTA';$('#token-to-display').innerText=this.d=='USDT_TO_FTA'?'FTA':'USDT';this.upd();}
    calc(){let v=$('#swap-from-in').value;if(!v)return $('#swap-to-in').value='';let r=this.d=='USDT_TO_FTA'?v*this.r:v/this.r;$('#swap-to-in').value=r.toFixed(5);}
    async ex(){ let v=$('#swap-from-in').value; if(!v||v<=0)return this.t("Montant invalide",1); this.setL(true,"Swap..."); let isU=this.d=='USDT_TO_FTA'; let dec=isU?6:this.dec; let am=ethers.parseUnits(v,dec); try{ let tc=isU?this.c.u:this.c.f; let al=await tc.allowance(this.u,CONFIG.MINING); if(al<am){await(await tc.approve(CONFIG.MINING,am)).wait();} let tx=isU?await this.c.m.swapUsdtForFta(am):await this.c.m.swapFtaForUsdt(am); await tx.wait(); this.t("Échangé !"); $('#swap-from-in').value=''; this.upd(); }catch(e){this.shE(e);} this.setL(false); }

    async claim(){ if(!this.u)return; this.stp(); this.setL(true,"Claim..."); try{ await(await this.c.m.claimRewards()).wait(); this.bal=0; localStorage.setItem(this.key,Math.floor(Date.now()/1000)); this.t("Réclamé !"); this.upd(); if(this.pow>0)this.str(); }catch(e){this.shE(e);this.str();} this.setL(false); }

    nav(v){ $$('.view').forEach(e=>{e.classList.remove('active');e.style.display='none';}); $('#view-'+v).classList.add('active'); $('#view-'+v).style.display='block'; $$('.nav-item').forEach(e=>e.classList.remove('active')); if(event&&event.currentTarget)event.currentTarget.classList.add('active'); if(v=='my-rigs')this.chk(); }
    async chk(){ let c=$('#my-rigs-list'); let nr=$('#no-rigs'); c.innerHTML=''; if(!this.u)return; try{ let n=await this.c.m.getMachineCount(); let pr=[]; for(let i=0;i<n;i++)pr.push(this.c.m.getUserMachineCount(this.u,i)); let res=await Promise.all(pr); let f=false; for(let i=0;i<n;i++){ if(res[i]>0){ f=true; let pw=this.shop[i]?this.shop[i].pw.toFixed(5):"N/A"; let div=document.createElement('div'); div.className='my-rig-card active'; div.innerHTML=`<div class="rig-info"><h4>RIG ${i+1} <span style="opacity:0.5">x${res[i]}</span></h4><p style="margin:0;color:var(--text-muted);font-size:0.8rem">${pw} FTA/s</p></div><span class="rig-status-badge status-active">ACTIF</span>`; c.appendChild(div); }} nr.classList.toggle('hidden',f); }catch(e){console.error(e);} }

    // --- GAMES VISUALS ---
    showGame(id){ $$('.game-area').forEach(e=>e.classList.remove('active')); $('#game-'+id).classList.add('active'); $$('.game-tab').forEach(btn=>btn.classList.remove('active')); event.currentTarget.classList.add('active'); }

    // WIN GO
    async playWinGo(type, choice) {
        const betVal = $('#wingo-bet').value;
        if (!betVal || betVal <= 0) return this.showToast("Mise invalide", true);
        const amount = ethers.parseUnits(betVal, this.dec);
        
        // Start Visual
        const reel = $('#slot-reel');
        reel.classList.add('spinning');
        
        this.setL(true, "Jeu...");
        try {
            const allow = await this.c.f.allowance(this.u, CONFIG.MINING);
            if (allow < amount) await (await this.c.f.approve(CONFIG.MINING, amount)).wait();
            await (await this.c.m.playWinGo(amount, type, choice)).wait();
            
            // Stop Visual
            reel.classList.remove('spinning');
            // Show random result for feedback (Real result should be from event)
            const randomNum = Math.floor(Math.random() * 10);
            const finalOffset = -80 * randomNum; 
            reel.style.transform = `translateY(${finalOffset}px)`;

            this.t("Jeu terminé !"); this.upd();
        } catch(e) { 
            reel.classList.remove('spinning');
            reel.style.transform = 'translateY(0px)';
            this.shE(e); 
        }
        this.setL(false);
    }

    // WHEEL
    initWheel() {
        const canvas = $('#wheel-canvas');
        if(!canvas) return;
        this.wheelState.ctx = canvas.getContext('2d');
        this.drawWheel(0);
    }

    drawWheel(rotation) {
        const ctx = this.wheelState.ctx;
        if(!ctx) return;
        const segments = ["10x", "2x", "5x", "1x", "50x", "0x", "3x", "JACKPOT"];
        const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#1e293b", "#ec4899", "#fbbf24"];
        
        ctx.clearRect(0, 0, 300, 300);
        ctx.save();
        ctx.translate(150, 150);
        ctx.rotate(rotation);
        ctx.translate(-150, -150);

        const step = (2 * Math.PI) / segments.length;
        for(let i=0; i<segments.length; i++) {
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.arc(150, 150, 140, i * step, (i + 1) * step);
            ctx.closePath();
            ctx.fillStyle = colors[i];
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.save();
            ctx.translate(150, 150);
            ctx.rotate(i * step + step / 2);
            ctx.textAlign = "right";
            ctx.fillStyle = "#fff";
            ctx.font = "bold 14px Outfit";
            ctx.fillText(segments[i], 110, 5);
            ctx.restore();
        }
        // Center circle
        ctx.beginPath();
        ctx.arc(150, 150, 20, 0, 2 * Math.PI);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();
    }

    async spinWheel() {
        this.setL(true, "Roue...");
        try {
            const price = ethers.parseUnits("100", this.dec); 
            const allow = await this.c.f.allowance(this.u, CONFIG.MINING);
            if (allow < price) await (await this.c.f.approve(CONFIG.MINING, price)).wait();
            
            const tx = this.c.m.spinWheel();
            
            // Animation Loop
            let anim = setInterval(() => {
                this.wheelState.angle += 0.3;
                this.drawWheel(this.wheelState.angle);
            }, 20);

            await tx;
            clearInterval(anim);
            
            // Smooth stop
            this.wheelState.angle += 10 + Math.random()*5;
            this.drawWheel(this.wheelState.angle);

            this.t("Résultat !"); this.upd();
        } catch(e) { this.shE(e); }
        this.setL(false);
    }
    
    // FISHING
    async goFishing() {
        const line = $('#fishing-line');
        const hook = $('#fishing-hook');
        const status = $('#fishing-status');
        
        line.style.height = '0px'; hook.style.top = '0px'; status.innerText = "Lancer...";
        
        this.setL(true, "Pêche...");
        try {
            const price = ethers.parseUnits("50", this.dec); 
            const allow = await this.c.f.allowance(this.u, CONFIG.MINING);
            if (allow < price) await (await this.c.f.approve(CONFIG.MINING, price)).wait();
            
            const tx = this.c.m.goFishing();
            
            // Animation
            setTimeout(() => {
                line.style.height = '120px'; hook.style.top = '120px'; status.innerText = "Ligne lancée...";
            }, 500);

            await tx;
            
            status.innerText = "Ça mord !";
            hook.style.fontSize = "3rem";
            setTimeout(() => hook.style.fontSize = "2rem", 500);

            this.t("Pêche terminée !"); this.upd();
        } catch(e) { status.innerText="Erreur"; this.shE(e); }
        this.setL(false);
    }
    
    async buyLotteryTicket() {
        this.setL(true, "Ticket...");
        try {
            const price = ethers.parseUnits("50", this.dec);
            const allow = await this.c.f.allowance(this.u, CONFIG.MINING);
            if (allow < price) await (await this.c.f.approve(CONFIG.MINING, price)).wait();
            await (await this.c.m.buyLotteryTicket()).wait();
            this.t("Ticket acheté !"); this.upd();
        } catch(e) { this.shE(e); }
        this.setL(false);
    }

    // --- VISUALIZER MINING ---
    initV(){ let cv=$('#mining-canvas'); if(!cv)return; this.rV(); this.vCtx=cv.getContext('2d'); this.vBars=[]; for(let i=0;i<20;i++)this.vBars.push({h:0,t:0}); this.aV(); }
    rV(){if(this.vCtx){let c=this.vCtx.canvas;c.width=c.offsetWidth*2;c.height=c.offsetHeight*2;}}
    updV(p){ let i=p>0?Math.min((p*500)+10,100):0; this.vBars.forEach(b=>b.t=(this.vCtx.canvas.height*(i/100))*Math.random());}
    aV(){ if(!this.vCtx)return; let cx=this.vCtx; cx.clearRect(0,0,cx.canvas.width,cx.canvas.height); cx.fillStyle="#10b981"; let w=cx.canvas.width/20; this.vBars.forEach((b,i)=>{ b.h+=(b.t-b.h)*0.1; cx.fillRect(i*w+2,cx.canvas.height-b.h,w-4,b.h); b.t+=(Math.random()-0.5)*10; }); requestAnimationFrame(()=>this.aV()); }

    // --- UTILS ---
    setL(s,m="Chargement..."){ let l=$('#loader'); $('#loader-text').innerText=m; s?l.classList.remove('hidden'):l.classList.add('hidden'); }
    shE(e){ console.error(e); let m="Erreur"; if(e.reason)m=e.reason; if(m.includes("Invalid bet"))m="Mise invalide"; this.t(m,1); }
    t(m,e=false){ let d=document.createElement('div'); d.className='toast'; if(e)d.style.borderColor='var(--danger)'; d.innerText=m; $('#toast-container').appendChild(d); setTimeout(()=>d.remove(),4000); }
}

const App = new Application();
window.onload = () => App.init();
let $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);