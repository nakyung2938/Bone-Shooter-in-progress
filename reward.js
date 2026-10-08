(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const prizes = ['10%', '15%', '20%', '메뉴권'];
  const weights = [.4, .28, .2, .12];
  const canvas = $('rewardWheel'), c = canvas.getContext('2d');
  const full = Math.PI * 2;
  let angle = 0, frame = 0, eligible = false, spinning = false, claimed = false;
  let stopping = false, started = 0, stopTime = 0, stopAngle = 0;
  const speed = full * 1.15;
  let reveal = 0, selected = 0;
  const machineArt = new Image(), capsuleArt = new Image();
  let artReady = false;
  function loadArt() {
    $('spinBtn').disabled = true;
    Promise.all([
      loadImage(machineArt, ['gacha-machine-source.png', 'gacha-machine-source.png']),
      loadImage(capsuleArt, ['gacha-capsules-source.png', 'gacha-capsules-source.png'])
    ]).then(() => {
      artReady = true;
      if (eligible && !claimed) {
        $('spinBtn').disabled = false;
        $('spinBtn').textContent = '캡슐 뽑기!';
        draw();
      }
    }).catch(() => {
      $('wheelStatus').textContent = '이미지를 불러오지 못했어요. 다시 시도해주세요.';
      $('spinBtn').disabled = false;
      $('spinBtn').textContent = '다시 불러오기';
    });
  }
  function loadImage(img, sources) {
    return new Promise((resolve, reject) => {
      let index = 0;
      const next = () => {
        img.onload = resolve;
        img.onerror = () => {
          index += 1;
          if (index < sources.length) { img.src = sources[index]; return; }
          reject(new Error(`Unable to load ${sources[0]}`));
        };
        img.src = sources[index];
      };
      next();
    });
  }
  function menuCapsule(x, y, size, index) {
    const centers = [175, 476, 773, 1071, 1365];
    const row = Math.floor(index / 5), col = index % 5;
    c.save(); c.translate(x, y); c.scale(size / 270, size / 270);
    c.beginPath();
    c.moveTo(-35,-133);c.lineTo(35,-133);c.lineTo(35,-124);
    c.bezierCurveTo(92,-113,124,-68,128,-18);
    c.lineTo(128,19);c.bezierCurveTo(115,87,68,126,0,133);
    c.bezierCurveTo(-68,126,-115,87,-128,19);
    c.lineTo(-128,-18);c.bezierCurveTo(-124,-68,-92,-113,-35,-124);
    c.closePath();c.clip();
    c.drawImage(capsuleArt, centers[col]-135, [214,519,815][row]-135,270,270,-135,-135,270,270);
    c.restore();
  }
  function drawArtwork() {
    c.clearRect(0,0,600,600);
    c.save(); c.imageSmoothingEnabled = false;
    // Clip the source silhouette without changing the supplied artwork.
    c.translate(58,-90); c.scale(.47,.47);
    c.beginPath();
    const outline=[[337,205],[689,205],[689,214],[759,214],[759,225],[794,225],[815,248],[815,302],[786,320],[755,341],[778,363],[834,420],[877,485],[912,592],[914,705],[885,790],[854,849],[850,877],[880,892],[901,921],[901,969],[877,991],[877,1285],[920,1303],[930,1371],[899,1393],[877,1428],[773,1428],[762,1405],[264,1405],[246,1428],[145,1428],[127,1394],[94,1373],[94,1306],[135,1287],[135,994],[123,973],[123,919],[152,892],[177,879],[147,810],[110,711],[110,601],[137,497],[186,414],[246,352],[253,334],[215,306],[210,248],[236,226],[268,217],[337,217]];
    outline.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();
    c.drawImage(machineArt,0,0);
    c.save();c.beginPath();c.ellipse(512,638,342,244,0,0,full);c.clip();
    for(let i=0;i<12;i++) {
      const moving=spinning&&!reveal, phase=i*2.399;
      const x=moving?512+Math.cos(phase+angle)*(110+(i%3)*65):300+(i%4)*140;
      const y=moving?630+Math.sin(phase+angle*1.17)*(90+(i%3)*40):570+Math.floor(i/4)*115;
      menuCapsule(x,y,155,i);
    }
    c.restore();
    if(reveal) menuCapsule(512,1215+reveal*52,155,[0,4,7,12][selected]);
    c.restore();
  }
  function capsule(x,y,r,color) {
    c.beginPath();c.arc(x,y,r,0,full);c.fillStyle='#fff0d6';c.fill();
    c.beginPath();c.arc(x,y,r,0,Math.PI);c.closePath();c.fillStyle=color;c.fill();
    c.beginPath();c.arc(x,y,r,0,full);c.strokeStyle='#392344';c.lineWidth=4;c.stroke();
    c.fillStyle='#ffffffaa';c.fillRect(x-r*.45,y-r*.55,r*.4,r*.18);
  }
  function draw() {
    if (artReady) { drawArtwork(); return; }
    c.clearRect(0,0,600,600);
    c.save();
    c.fillStyle='#09050e';c.beginPath();c.ellipse(300,564,194,19,0,0,full);c.fill();
    c.fillStyle='#4e2c68';c.fillRect(155,344,290,201);
    c.fillStyle='#9464b3';c.fillRect(145,345,310,22);c.fillRect(137,533,326,24);
    c.fillStyle='#efc65a';c.fillRect(191,382,218,43);
    c.textAlign='center';c.font='26px Mulmaru, sans-serif';c.fillStyle='#291536';c.fillText('BON! LUCKY',300,412);
    c.fillStyle='#130b20';c.fillRect(242,447,116,77);c.fillStyle='#764991';c.fillRect(242,518,116,8);
    c.beginPath();c.arc(300,208,179,0,full);c.fillStyle='#23152fee';c.fill();c.strokeStyle='#d4b0e9';c.lineWidth=9;c.stroke();
    c.save();c.beginPath();c.arc(300,208,170,0,full);c.clip();
    const colors=['#b38bd2','#efc65a','#78539f'];
    for(let i=0;i<11;i++) {
      const phase=i*2.399, radius=62+(i%3)*33;
      const moving=spinning && !reveal;
      const x=moving?300+Math.cos(phase+angle)*radius:207+(i%4)*61;
      const y=moving?208+Math.sin(phase+angle*1.17)*radius:207+Math.floor(i/4)*55;
      capsule(x,y,30,colors[i%3]);
    }
    c.restore();
    c.strokeStyle='#ffffff77';c.lineWidth=13;c.beginPath();c.arc(300,208,152,3.7,4.5);c.stroke();
    c.fillStyle='#edc45a';c.fillRect(245,14,110,22);
    if(reveal) capsule(300,460+Math.min(1,reveal)*34,33,'#efc65a');
    c.restore();
  }
  function reset() {
    cancelAnimationFrame(frame);spinning=false;stopping=false;claimed=false;eligible=false;angle=0;reveal=0;
    $('wheelArea').hidden=true;$('resultScreen').classList.remove('has-wheel');
    $('spinBtn').disabled=false;$('spinBtn').textContent='캡슐 뽑기!';
    $('restartBtn').disabled=false;
    if ($('couponDialog').open) $('couponDialog').close();
  }
  function show(score) {
    reset();eligible=score>=3000;
    $('couponReward').textContent=eligible ? '행운의 캡슐 · 1회' : `${(3000-score).toLocaleString('ko-KR')}점 더 모으면 보상 획득!`;
    $('rewardNote').textContent=eligible ? '할인 쿠폰부터 한 그릇 메뉴권까지' : '3,000점 이상 달성하면 캡슐을 뽑을 수 있어요';
    if(!eligible)return;
    $('resultTitle').textContent='MISSION CLEAR!';
    $('wheelArea').hidden=false;$('resultScreen').classList.add('has-wheel');
    $('wheelStatus').textContent='행운의 회복 아이템을 뽑아봐!';
    if (!artReady) loadArt();
    draw();
  }
  function stop(now) {
    if(stopping)return;
    stopping=true;stopTime=Math.min(now,started+10000);stopAngle=speed*(stopTime-started)/1000;
    $('spinBtn').disabled=true;$('spinBtn').textContent='두근두근…';
  }
  $('spinBtn').addEventListener('click',()=>{
    if(!eligible||claimed||stopping)return;
    if(!artReady){loadArt();return;}
    if(spinning){stop(performance.now());return;}
    spinning=true;$('restartBtn').disabled=true;
    $('wheelStatus').textContent='지금이다 싶을 때, 정지!';
    started=performance.now();
    const roll=Math.random();let cumulative=0;
    selected=weights.findIndex(w=>{cumulative+=w;return roll<cumulative;});
    function tick(now){
      if(!stopping && now-started>=10000)stop(started+10000);
      let t=0;
      if(stopping){t=Math.min(1,(now-stopTime)/3200);angle=stopAngle+speed*3.2*(t-t*t+t*t*t/3);}
      else {angle=speed*(now-started)/1000;$('spinBtn').textContent=`정지! · ${Math.ceil((10000-now+started)/1000)}초`;}
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches||t===1)draw();
      if(t<1){frame=requestAnimationFrame(tick);return;}
      reveal=Math.min(1,(now-stopTime-3200)/650);draw();
      if(reveal<1){frame=requestAnimationFrame(tick);return;}
      const index=selected;
      spinning=false;claimed=true;$('restartBtn').disabled=false;
      $('couponReward').textContent=index===3?'본죽 한 그릇 메뉴권':`본죽 ${prizes[index]} 할인 쿠폰`;
      $('wheelStatus').textContent='오늘의 회복 아이템 획득!';
      $('spinBtn').textContent='획득 완료!';
      $('couponAmount').textContent=prizes[index];
      $('couponKind').textContent=index===3?'한 그릇 메뉴권':'할인 쿠폰';
      $('couponTitle').textContent=index===3?'MENU GET!':'COUPON GET!';
      $('couponDialog').showModal();
      $('couponConfirm').focus({preventScroll:true});
    }
    frame=requestAnimationFrame(tick);
  });
  $('couponConfirm').addEventListener('click', () => $('couponDialog').close());
  $('couponDialog').addEventListener('close', () => $('restartBtn').focus({preventScroll:true}));
  window.BonReward={show,reset};
})();
