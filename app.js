const $=id=>document.getElementById(id),fileInput=$('file');
const API='https://pogoapi.net/api/v1/',SPRITES='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/',CSV='https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/',PVPOKE='https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/';
const DEFAULT_CROP={x:0,y:.07,w:1,h:.325};
let catalog=[],movePools=[],fastMoves=[],chargedMoves=[],pokemonStats=[],cpms=[],battleRankings=null,battleRankingsPromise=null,moveJa=new Map(),currentBitmap=null,cropRect=null,cropStart=null,visionModel=null,ocrWorker=null,currentPokemon=null,currentIV=null;
const evolutionCache=new Map();
const pvpIvCache=new Map();
const FORM_JA={normal:'通常のすがた',alola:'アローラのすがた',alolan:'アローラのすがた',galar:'ガラルのすがた',galarian:'ガラルのすがた',hisui:'ヒスイのすがた',hisuian:'ヒスイのすがた',paldea:'パルデアのすがた',paldean:'パルデアのすがた',origin:'オリジンフォルム',altered:'アナザーフォルム',attack:'アタックフォルム',defense:'ディフェンスフォルム',speed:'スピードフォルム',incarnate:'けしんフォルム',therian:'れいじゅうフォルム',aria:'ボイスフォルム',pirouette:'ステップフォルム',sunshine:'ポジフォルム',overcast:'ネガフォルム',east_sea:'ひがしのうみ',west_sea:'にしのうみ',midday:'まひるのすがた',midnight:'まよなかのすがた',dusk:'たそがれのすがた',solo:'たんどくのすがた',school:'むれたすがた',average:'ふつうのサイズ',small:'ちいさいサイズ',large:'おおきいサイズ',super:'とくだいサイズ'};
FORM_JA.shadow='シャドウ';
const EXTRA_CPMS=[[45.5,.817803806],[46,.82029999],[46.5,.822803778],[47,.82529999],[47.5,.82780375],[48,.83029999],[48.5,.832803753],[49,.835300028],[49.5,.837803755],[50,.84029999]];
const MOVE_JA_ALIASES={
  aurawheelelectric:'オーラぐるま（でんき）',
  hydropumpblastoise:'ハイドロポンプ',
  mystfire:'マジカルフレイム',
  scaldblastoise:'ねっとう',
  technoblastburn:'テクノバスター（ほのお）',
  technoblastchill:'テクノバスター（こおり）',
  technoblastnormal:'テクノバスター（ノーマル）',
  technoblastshock:'テクノバスター（でんき）',
  technoblastwater:'テクノバスター（みず）',
  vicegrip:'はさむ',
  watergunblastoise:'みずでっぽう',
  weatherballfire:'ウェザーボール（ほのお）',
  weatherballice:'ウェザーボール（こおり）',
  weatherballnormal:'ウェザーボール（ノーマル）',
  weatherballrock:'ウェザーボール（いわ）',
  weatherballwater:'ウェザーボール（みず）',
  wildboldstorm:'かみなりあらし',
  wrapgreen:'まきつく',
  wrappink:'まきつく'
};
const shadowIdsPromise=get('shadow_pokemon.json').then(x=>new Set(Object.values(x).map(p=>+p.id))).catch(()=>new Set());
fileInput.addEventListener('change',handleFileChange);
$('pokemonSelect').addEventListener('input',handlePokemonSearch);
$('again').addEventListener('click',resetApp);
$('formSelect').addEventListener('change',handleFormChange);

async function handleFileChange(){
  const file=fileInput.files?.[0];
  if(!file)return;
  resetRecognitionUI();
  try{
    currentBitmap=await createImageBitmap(file);
    showResult(analyze(currentBitmap));
    await loadData();
    finishRecognition();
    $('pokemonName').textContent='日本語名を入力';
    $('recognition').textContent='手動選択';
    $('pokemonSelect').focus();
  }catch(error){
    finishRecognition();
    $('pokemonName').textContent='判定できませんでした';
    $('recognition').textContent='手動検索できます';
    console.error(error);
    alert(`処理できませんでした: ${error.message}`);
  }
}

function resetRecognitionUI(){
  $('ivPurpose').hidden=true;
  $('scanStatus').hidden=false;
  $('nameFallback').hidden=true;
  $('scanStatus').querySelector('b').textContent='図鑑データを準備しています';
  $('pokemonName').textContent='準備中…';
}

function finishRecognition(){
  $('scanStatus').hidden=true;
  $('nameFallback').hidden=false;
}

function handlePokemonSearch(event){
  const query=normalizeJapaneseSearch(event.target.value);
  const matches=query?catalog
    .filter(pokemon=>pokemon.searchKey.includes(query))
    .sort((a,b)=>Number(b.searchKey.startsWith(query))-Number(a.searchKey.startsWith(query))||a.ja.length-b.ja.length)
    .slice(0,8):[];
  renderPokemonMatches(matches);
  const exact=matches.find(pokemon=>pokemon.searchKey===query);
  if(exact)choosePokemon(exact);
}

function normalizeJapaneseSearch(value){
  return String(value).normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g,char=>String.fromCharCode(char.charCodeAt(0)+0x60)).replace(/[\s・･ー\-_'’]/g,'');
}

function renderPokemonMatches(matches){
  const container=$('pokemonMatches');
  container.replaceChildren(...matches.map(pokemon=>{
    const button=document.createElement('button');
    button.type='button';
    button.textContent=pokemon.ja;
    button.addEventListener('click',()=>choosePokemon(pokemon));
    return button;
  }));
}

function choosePokemon(pokemon){
  $('pokemonSelect').value=pokemon.ja;
  $('pokemonMatches').replaceChildren();
  selectPokemon(pokemon);
}

function handleFormChange(event){
  if(!currentPokemon)return;
  applyForm(currentPokemon,event.target.value);
}

function resetApp(){
  fileInput.value='';
  $('pokemonSelect').value='';
  $('pokemonMatches').replaceChildren();
  $('result').hidden=true;
  $('picker').hidden=false;
  $('moves').hidden=true;
  scrollTo({top:0,behavior:'smooth'});
}

async function loadData(){
  if(catalog.length)return;
  setProgress('全ポケモンと日本語名を取得中…');
  const [released,pools,fast,charged,stats,multipliers,namesCsv,movesCsv]=await Promise.all([
    get('released_pokemon.json'),
    get('current_pokemon_moves.json'),
    get('fast_moves.json'),
    get('charged_moves.json'),
    get('pokemon_stats.json'),
    get('cp_multiplier.json'),
    fetchCsv('pokemon_species_names.csv'),
    fetchCsv('move_names.csv')
  ]);
  movePools=pools;
  fastMoves=fast;
  chargedMoves=charged;
  pokemonStats=stats;
  cpms=prepareCpMultipliers(multipliers);
  moveJa=parseMoveNames(movesCsv);
  catalog=buildCatalog(released,pools,parsePokemonNames(namesCsv));
  $('pokemonList').replaceChildren(...catalog.map(pokemon=>new Option('',pokemon.ja)));
  if(!catalog.length)throw Error('図鑑データを取得できません');
}

async function fetchCsv(path){
  const response=await fetch(CSV+path);
  if(!response.ok)throw Error('日本語データを取得できません');
  return response.text();
}

function prepareCpMultipliers(source){
  const result=source.map(item=>({level:+item.level,multiplier:+item.multiplier})).filter(item=>item.multiplier);
  for(const [level,multiplier] of EXTRA_CPMS){
    if(!result.some(item=>item.level===level))result.push({level,multiplier});
  }
  return result.filter(item=>item.level<=50).sort((a,b)=>a.level-b.level);
}

function parsePokemonNames(csv){
  const names=new Map();
  for(const line of csv.split(/\r?\n/)){
    const match=line.match(/^(\d+),1,("(?:[^"]|"")*"|[^,]*)/);
    if(match)names.set(+match[1],csvValue(match[2]));
  }
  return names;
}

function parseMoveNames(csv){
  const rows=new Map(),names=new Map();
  for(const line of csv.split(/\r?\n/)){
    const match=line.match(/^(\d+),(1|9),("(?:[^"]|"")*"|[^,]*)/);
    if(!match)continue;
    const row=rows.get(+match[1])||{};
    row[match[2]]=csvValue(match[3]);
    rows.set(+match[1],row);
  }
  for(const row of rows.values())if(row[1]&&row[9])names.set(normalize(row[9]),row[1]);
  for(const [english,japanese] of Object.entries(MOVE_JA_ALIASES))names.set(english,japanese);
  return names;
}

function buildCatalog(released,pools,japaneseNames){
  const releasedIds=new Set(Object.values(released).map(item=>+item.id)),seen=new Set();
  return pools
    .filter(item=>releasedIds.has(+item.pokemon_id)&&!seen.has(+item.pokemon_id)&&seen.add(+item.pokemon_id))
    .map(item=>({
      id:+item.pokemon_id,
      name:item.pokemon_name,
      ja:japaneseNames.get(+item.pokemon_id)||`図鑑番号 ${item.pokemon_id}`,
      searchKey:normalizeJapaneseSearch(japaneseNames.get(+item.pokemon_id)||`図鑑番号 ${item.pokemon_id}`),
      sprite:`${SPRITES}${item.pokemon_id}.png`,
      art:`${SPRITES}other/home/${item.pokemon_id}.png`
    }));
}
function csvValue(s){return s.replace(/^"|"$/g,'').replace(/""/g,'"')}function normalize(s){return String(s).toLowerCase().replace(/[^a-z0-9]/g,'')}
async function get(path){const r=await fetch(API+path);if(!r.ok)throw Error(`データ取得エラー (${r.status})`);return r.json()}

async function classify(bitmap,manualRect=null){const rects=manualRect?[manualRect]:[DEFAULT_CROP,{x:.06,y:.08,w:.88,h:.30},{x:.14,y:.10,w:.72,h:.28}],targets=rects.map(r=>descriptorFromBitmap(bitmap,r)),scores=[];let done=0,queue=[...catalog];const best=d=>Math.min(...targets.map(t=>distance(t,d)));async function worker(){while(queue.length){const p=queue.shift();try{scores.push({...p,score:best(descriptorFromImage(await loadImage(p.sprite)))})}catch{}done++;if(done%25===0)setProgress(`${done} / ${catalog.length}種類を一次照合中`)}}await Promise.all(Array.from({length:18},worker));scores.sort((a,b)=>a.score-b.score);const refined=[];queue=scores.slice(0,120);done=0;async function refine(){while(queue.length){const p=queue.shift();try{p.score=best(descriptorFromImage(await loadImage(p.art)));refined.push(p)}catch{refined.push(p)}done++;if(done%4===0)setProgress(`${done} / 120種類を画像特徴で再照合中`)}}await Promise.all(Array.from({length:10},refine));refined.sort((a,b)=>a.score-b.score);let ranked=refined;try{ranked=await semanticRank(bitmap,rects,refined.slice(0,72))}catch(e){console.warn('学習済みモデルを利用できないため従来照合を使用します',e)}const top=ranked.slice(0,8);await Promise.all(top.map(localize));renderCandidates(top);$('scanStatus').hidden=true;$('candidates').hidden=false;$('nameFallback').hidden=false;$('pokemonName').textContent=top[0]?.ja||'候補なし';$('recognition').textContent=visionModel?'AI特徴で候補を抽出':'候補を確認してください'}
async function semanticRank(bitmap,rects,list){setProgress('ポケモン本体の背景を除去中…');const model=await loadVisionModel(),targetEmbeddings=[];for(let i=0;i<rects.length;i++){const input=segmentObject(bitmap,rects[i]);if(i===0)showObjectPreview(input);targetEmbeddings.push(await embedding(model,input))}const ranked=[];for(let i=0;i<list.length;i++){const p=list[i];try{const e=await embedding(model,referenceForModel(await loadImage(p.art)));p.semantic=Math.min(...targetEmbeddings.map(t=>cosineDistance(t,e)))}catch{p.semantic=9}ranked.push(p);if(i%3===0)setProgress(`${i+1} / ${list.length}種類をAI特徴で最終照合中`);await new Promise(requestAnimationFrame)}return ranked.sort((a,b)=>a.semantic-b.semantic)}
async function loadVisionModel(){if(visionModel)return visionModel;await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js','tf');await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js','mobilenet');await tf.ready();visionModel=await mobilenet.load({version:2,alpha:.5});return visionModel}
function loadScript(src,globalName){if(globalThis[globalName])return Promise.resolve();return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error(`${globalName}を読み込めません`));document.head.append(s)})}
function segmentObject(bitmap,r){const size=160,src=document.createElement('canvas');src.width=src.height=size;const x=src.getContext('2d',{willReadFrequently:true});x.drawImage(bitmap,bitmap.width*r.x,bitmap.height*r.y,bitmap.width*r.w,bitmap.height*r.h,0,0,size,size);const image=x.getImageData(0,0,size,size),d=image.data,bg=new Uint8Array(size*size),q=[];for(let n=0;n<size;n++){for(const i of [n,size*(size-1)+n,n*size,n*size+size-1])if(!bg[i]){bg[i]=1;q.push(i)}}for(let k=0;k<q.length;k++){const n=q[k],px=n%size,py=n/size|0,i=n*4;for(const z of [n-1,n+1,n-size,n+size]){if(z<0||z>=bg.length||bg[z]||Math.abs((z%size)-px)+Math.abs((z/size|0)-py)!==1)continue;const j=z*4,delta=Math.hypot(d[i]-d[j],d[i+1]-d[j+1],d[i+2]-d[j+2]);if(delta<26){bg[z]=1;q.push(z)}}}let fg=new Uint8Array(bg.length);for(let i=0;i<fg.length;i++)fg[i]=+!bg[i];fg=mainComponent(fg,size);let minX=size,minY=size,maxX=0,maxY=0,count=0;for(let n=0;n<fg.length;n++)if(fg[n]){const px=n%size,py=n/size|0;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);d[n*4+3]=255;count++}else d[n*4+3]=0;x.putImageData(image,0,0);if(count<80){minX=0;minY=0;maxX=size-1;maxY=size-1}const pad=5,w=maxX-minX+1,h=maxY-minY+1,out=document.createElement('canvas');out.width=out.height=224;const o=out.getContext('2d');o.fillStyle='#fff';o.fillRect(0,0,224,224);const scale=Math.min(194/(w+pad*2),194/(h+pad*2)),dw=w*scale,dh=h*scale;o.drawImage(src,Math.max(0,minX-pad),Math.max(0,minY-pad),Math.min(size-minX+pad,w+pad*2),Math.min(size-minY+pad,h+pad*2),(224-dw)/2,(224-dh)/2,dw,dh);return out}
function referenceForModel(img){const c=document.createElement('canvas');c.width=c.height=224;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,224,224);x.drawImage(img,12,12,200,200);return c}
function showObjectPreview(source){const c=$('objectPreview');c.width=c.height=224;c.getContext('2d').drawImage(source,0,0)}
async function embedding(model,image){const tensor=model.infer(image,true);try{return Float32Array.from(await tensor.data())}finally{tensor.dispose()}}
function cosineDistance(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return 1-dot/Math.max(1e-9,Math.sqrt(aa*bb))}
function setProgress(s){$('scanProgress').textContent=s}
function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image;i.crossOrigin='anonymous';i.onload=()=>resolve(i);i.onerror=reject;i.src=src})}
async function identifyByCatchText(bitmap){try{setProgress('「この○○を捕まえた」を日本語で読取中…');const image=catchTextCanvas(bitmap);let text='';if('TextDetector'in window)try{text=(await new TextDetector().detect(image)).map(x=>x.rawValue).join(' ')}catch{}if(!findJapaneseName(text)){await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');if(!ocrWorker){ocrWorker=await Tesseract.createWorker('jpn',1,{logger:m=>{if(m.status==='recognizing text')setProgress(`捕獲情報を読取中… ${Math.round((m.progress||0)*100)}%`)}});await ocrWorker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'})}text=(await ocrWorker.recognize(image)).data.text}console.info('捕獲情報OCR:',text);return findJapaneseName(text)}catch(e){console.warn('捕獲情報OCRを利用できません',e);return null}}
function catchTextCanvas(bitmap){const r={x:.035,y:.855,w:.93,h:.14},c=document.createElement('canvas');c.width=1100;c.height=Math.round(1100*(bitmap.height*r.h)/(bitmap.width*r.w));const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bitmap,bitmap.width*r.x,bitmap.height*r.y,bitmap.width*r.w,bitmap.height*r.h,0,0,c.width,c.height);const image=x.getImageData(0,0,c.width,c.height),d=image.data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=(d[i]*.299+d[i+1]*.587+d[i+2]*.114);const mean=sum/(d.length/4);for(let i=0;i<d.length;i+=4){const g=d[i]*.299+d[i+1]*.587+d[i+2]*.114,v=g<mean*.88?0:255;d[i]=d[i+1]=d[i+2]=v}x.putImageData(image,0,0);return c}
function findJapaneseName(raw){const text=normalizeJa(raw);const exact=[...catalog].sort((a,b)=>b.ja.length-a.ja.length).find(p=>text.includes(normalizeJa(p.ja)));if(exact)return exact;const m=text.match(/この(.{2,12}?)(?:を|お)(?:捕|つか)/);if(!m)return null;let best=null,score=99;for(const p of catalog){const d=levenshtein(m[1],normalizeJa(p.ja));if(d<score){score=d;best=p}}return best&&score<=Math.max(1,Math.floor(best.ja.length*.3))?best:null}
function normalizeJa(s){return String(s).normalize('NFKC').replace(/[\s。、・「」『』()（）]/g,'')}
function levenshtein(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return row[b.length]}
function descriptorFromBitmap(b,r){return makeDescriptor(b,r)}function descriptorFromImage(img){return makeDescriptor(img,null)}
function makeDescriptor(source,r){const size=96,c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d',{willReadFrequently:true});if(r)x.drawImage(source,source.width*r.x,source.height*r.y,source.width*r.w,source.height*r.h,0,0,size,size);else x.drawImage(source,0,0,size,size);return features(x.getImageData(0,0,size,size).data,size,!r)}
function features(data,size,hasAlpha){const bg=[0,0,0];let bn=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(x<5||x>=size-5||y<5||y>=size-5){const i=(y*size+x)*4;if(data[i+3]>30){bg[0]+=data[i];bg[1]+=data[i+1];bg[2]+=data[i+2];bn++}}bg.forEach((_,i)=>bg[i]/=Math.max(1,bn));let mask=new Uint8Array(size*size);for(let n=0;n<mask.length;n++){const i=n*4,d=Math.hypot(data[i]-bg[0],data[i+1]-bg[1],data[i+2]-bg[2]);mask[n]=hasAlpha?+(data[i+3]>45):+(d>42&&data[i+3]>45)}mask=mainComponent(mask,size);let minX=size,minY=size,maxX=0,maxY=0,count=0;for(let n=0;n<mask.length;n++)if(mask[n]){const x=n%size,y=n/size|0;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++}if(count<30){mask.fill(1);minX=minY=0;maxX=maxY=size-1;count=mask.length}const out=Array(20).fill(0),cells=8;for(let cy=0;cy<cells;cy++)for(let cx=0;cx<cells;cx++){let occupied=0,light=0,total=0;const xa=Math.floor(minX+(maxX-minX+1)*cx/cells),xb=Math.floor(minX+(maxX-minX+1)*(cx+1)/cells),ya=Math.floor(minY+(maxY-minY+1)*cy/cells),yb=Math.floor(minY+(maxY-minY+1)*(cy+1)/cells);for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){total++;const n=y*size+x;if(!mask[n])continue;occupied++;const i=n*4,r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,s=max?d/max:0;let hue=0;if(d){hue=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;hue=(hue*60+360)%360}out[Math.min(11,hue/30|0)]+=s+.15;out[12+Math.min(3,s*4|0)]++;out[16+Math.min(3,max*4|0)]++;light+=max}out.push(occupied/Math.max(1,total),occupied?light/occupied:0)}for(let i=0;i<20;i++)out[i]=out[i]/count*2.2;return out}
function mainComponent(mask,size){const seen=new Uint8Array(mask.length),best=[];for(let start=0;start<mask.length;start++){if(!mask[start]||seen[start])continue;const q=[start],part=[];seen[start]=1;for(let k=0;k<q.length;k++){const n=q[k],x=n%size,y=n/size|0;part.push(n);for(const z of [n-1,n+1,n-size,n+size])if(z>=0&&z<mask.length&&!seen[z]&&mask[z]&&(Math.abs((z%size)-x)+Math.abs((z/size|0)-y)===1)){seen[z]=1;q.push(z)}}const center=part.some(n=>{const x=n%size,y=n/size|0;return x>size*.2&&x<size*.8&&y>size*.15&&y<size*.85});if(center&&part.length>best.length){best.length=0;best.push(...part)}}const out=new Uint8Array(mask.length);(best.length?best:[...mask.keys()].filter(i=>mask[i])).forEach(i=>out[i]=1);return out}
function distance(a,b){return Math.sqrt(a.reduce((s,v,i)=>s+(v-b[i])**2,0))}
async function localize(p){if(p.types)return;try{const detail=await fetch(`https://pokeapi.co/api/v2/pokemon/${p.id}`).then(r=>r.json());p.types=detail.types.map(t=>title(t.type.name))}catch{p.types=[]}}
function renderCandidates(list){const grid=$('candidateGrid');grid.replaceChildren();list.forEach(p=>{const b=document.createElement('button');b.className='candidate';b.type='button';b.innerHTML=`<img src="${p.art||p.sprite}" alt=""><span>${escapeHtml(p.ja)}</span>`;b.onclick=()=>{grid.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectPokemon(p)};grid.append(b)})}
async function selectPokemon(pokemon){
  if(!pokemon.ja||!pokemon.types)await localize(pokemon);
  currentPokemon=pokemon;
  $('pokemonName').textContent=pokemon.ja;
  $('recognition').textContent='選択済み';
  $('pokemonSelect').value=pokemon.ja;
  const art=$('selectedPokemonArt');
  art.src=pokemon.art||pokemon.sprite;
  art.alt=`${pokemon.ja}のイラスト`;
  art.hidden=false;
  await setupForms(pokemon);
}

async function setupForms(pokemon){
  const availablePools=movePools.filter(pool=>+pool.pokemon_id===pokemon.id);
  const forms=new Map();
  for(const pool of availablePools){
    const form=pool.form||'Normal';
    if(FORM_JA[formKey(form)]&&!forms.has(form))forms.set(form,pool);
  }
  if(!forms.size&&availablePools[0])forms.set(availablePools[0].form||'Normal',availablePools[0]);
  if((await shadowIdsPromise).has(pokemon.id))forms.set('Shadow',forms.get('Normal')||forms.values().next().value);

  const formNames=[...forms.keys()];
  const select=$('formSelect');
  select.replaceChildren(...formNames.map((form,index)=>new Option(formLabel(form,index),form)));
  $('formPicker').hidden=formNames.length<=1;
  applyForm(pokemon,formNames[0]||'Normal');
}

function applyForm(pokemon,form){
  showMoves(pokemon,form);
  updateOptimalIV(pokemon,form);
}

function formKey(form){return String(form||'Normal').toLowerCase().replace(/[ -]/g,'_')}
function formLabel(form,index){return FORM_JA[formKey(form)]||`別のすがた ${index+1}`}
function showMoves(pokemon,form){
  const moveForm=form==='Shadow'?'Normal':form;
  const pools=movePools.filter(item=>+item.pokemon_id===pokemon.id&&(item.form||'Normal')===moveForm);
  if(!pools.length){
    $('moves').hidden=true;
    return;
  }
  const fastNames=uniqueMoves(pools,'fast_moves','elite_fast_moves');
  const chargedNames=uniqueMoves(pools,'charged_moves','elite_charged_moves');
  const rankedFast=rankMoves(fastNames,fastMoves,move=>scoreFast(move,pokemon.types));
  const rankedCharged=rankMoves(chargedNames,chargedMoves,move=>scoreCharged(move,pokemon.types));
  const selectedFast=rankedFast[0]?.name||fastNames[0];
  const selectedCharged=(rankedCharged.length?rankedCharged.slice(0,2).map(move=>move.name):chargedNames.slice(0,2));
  const hasLegacy=isLegacyMove(selectedFast,pools,'fast_moves','elite_fast_moves')||selectedCharged.some(name=>isLegacyMove(name,pools,'charged_moves','elite_charged_moves'));
  const suffix=form==='Normal'?'':`（${formLabel(form,0)}）`;
  $('moveTitle').textContent=`${pokemon.ja}${suffix}を活かすなら`;
  $('fastMove').textContent=formatMoveName(selectedFast,pools,'fast_moves','elite_fast_moves');
  $('chargedMoves').textContent=selectedCharged.map(name=>formatMoveName(name,pools,'charged_moves','elite_charged_moves')).join(' ／ ')||'データなし';
  $('moveNote').textContent=`現在の技データから、タイプ一致・ダメージ効率・ゲージ効率を基準に算出した候補です。${hasLegacy?'【レガシー】は期間限定技などで、通常のわざマシンでは覚えません。すごいわざマシンが必要です。':'対戦リーグや相手によって最適解は変わります。'}`;
  $('moves').hidden=false;
}

function uniqueMoves(pools,regularKey,eliteKey){
  return [...new Set(pools.flatMap(pool=>[...(pool[regularKey]||[]),...(pool[eliteKey]||[])]))];
}

function rankMoves(names,source,score){
  return names.map(name=>source.find(move=>move.name===name)).filter(Boolean).sort((a,b)=>score(b)-score(a));
}

function moveNameJa(name){return moveJa.get(normalize(name))||'日本語名未収録'}
function isLegacyMove(name,pools,regularKey,eliteKey){
  if(!name)return false;
  const isRegular=pools.some(pool=>(pool[regularKey]||[]).includes(name));
  const isElite=pools.some(pool=>(pool[eliteKey]||[]).includes(name));
  return isElite&&!isRegular;
}

function formatMoveName(name,pools,regularKey,eliteKey){
  const label=moveNameJa(name);
  return isLegacyMove(name,pools,regularKey,eliteKey)?`${label}【レガシー】`:label;
}
function updateOptimalIV(p,form){
  const sameId=pokemonStats.filter(x=>+(x.pokemon_id??x.id)===p.id),key=normalize(form||'Normal');
  const stats=sameId.find(x=>normalize(x.form||'Normal')===key)||sameId.find(x=>normalize(x.form||'Normal')==='normal')||sameId[0];
  const base=stats&&{attack:+(stats.base_attack??stats.attack),defense:+(stats.base_defense??stats.defense),stamina:+(stats.base_stamina??stats.stamina)};
  if(!base||Object.values(base).some(x=>!Number.isFinite(x))||!cpms.length){$('ivPurpose').hidden=true;return}
  ensureRankingUI();
  const great=bestPvPIV(base,1500,currentIV),ultra=bestPvPIV(base,2500,currentIV);
  const put=(prefix,best)=>{$(`${prefix}IV`).textContent=`${best.attack} / ${best.defense} / ${best.stamina}`;$(`${prefix}Detail`).textContent=`Lv.${best.level}・CP ${best.cp}`;$(`${prefix}OwnRank`).textContent=currentIV?`この個体: ${best.ownRank}位 / 4096（上位${(best.ownRank/4096*100).toFixed(1)}%）`:''};
  put('great',great);put('ultra',ultra);$('ivPurpose').hidden=false;
  updateSpeciesRankings(p,form);
  updateEvolutionRankings(p,form);
}
function bestPvPIV(base,cap,own){
  const cacheKey=[base.attack,base.defense,base.stamina,cap,own?.attack,own?.defense,own?.stamina].join(':');
  if(pvpIvCache.has(cacheKey))return pvpIvCache.get(cacheKey);
  const results=[];
  for(let attack=0;attack<=15;attack++)for(let defense=0;defense<=15;defense++)for(let stamina=0;stamina<=15;stamina++){
    for(let i=cpms.length-1;i>=0;i--){
      const {level,multiplier:m}=cpms[i],cp=Math.max(10,Math.floor((base.attack+attack)*Math.sqrt(base.defense+defense)*Math.sqrt(base.stamina+stamina)*m*m/10));
      if(cp>cap)continue;
      const hp=Math.max(10,Math.floor((base.stamina+stamina)*m)),product=(base.attack+attack)*(base.defense+defense)*m*m*hp;
      results.push({product,attack,defense,stamina,level,cp});
      break;
    }
  }
  results.sort((a,b)=>b.product-a.product||b.cp-a.cp||b.attack-a.attack);
  const ownIndex=own?results.findIndex(x=>x.attack===own.attack&&x.defense===own.defense&&x.stamina===own.stamina):-1;
  const result={...results[0],ownRank:ownIndex+1};
  pvpIvCache.set(cacheKey,result);
  return result;
}
function ensureRankingUI(){
  if($('greatSpeciesRank'))return;
  const section=$('ivPurpose'),eyebrow=section.querySelector('.eyebrow'),note=section.querySelector(':scope>p'),cards=section.querySelectorAll('.iv-grid>div');
  eyebrow.textContent='用途別・個体値と対戦ランキング';note.textContent='全体順位はPvPokeのオープンリーグ総合ランキングです。個体値順位は同じポケモンの4096通りをステータス積で比較しています。';
  [['great',cards[0]],['ultra',cards[1]],['master',cards[2]]].forEach(([prefix,card])=>{const rank=document.createElement('strong');rank.id=`${prefix}SpeciesRank`;rank.className='species-rank';rank.style.cssText='display:block;margin-top:9px;color:#ef6f63;font-size:11px';rank.textContent='全体順位を取得中…';card.append(rank);if(prefix!=='master'){const own=document.createElement('span');own.id=`${prefix}OwnRank`;own.className='own-rank';card.append(own)}});
  const master=document.createElement('span');master.textContent='個体値1位: 15 / 15 / 15';cards[2].append(master);
  const evolutions=document.createElement('div');evolutions.id='evolutionRankings';evolutions.style.cssText='margin-top:16px;padding-top:16px;border-top:1px solid #dce5e3';section.insertBefore(evolutions,note);
}
async function updateSpeciesRankings(p,form){
  ['great','ultra','master'].forEach(x=>$(`${x}SpeciesRank`).textContent='全体順位を取得中…');
  try{
    await loadBattleRankings();
    for(const [prefix,cp] of [['great',1500],['ultra',2500],['master',10000]]){
      const list=battleRankings[cp],index=findBattleRank(list,p.name,form);
      $(`${prefix}SpeciesRank`).textContent=index>=0?`ポケモン全体: ${index+1}位 / ${list.length}（評価 ${list[index].score}）`:'全体ランキング対象外';
    }
  }catch(e){['great','ultra','master'].forEach(x=>$(`${x}SpeciesRank`).textContent='全体順位を取得できません');console.warn(e)}
}
async function loadBattleRankings(){
  if(battleRankings)return battleRankings;
  if(battleRankingsPromise)return battleRankingsPromise;
  const files=[1500,2500,10000];
  battleRankingsPromise=Promise.all(files.map(async cp=>{
    const response=await fetch(`${PVPOKE}rankings-${cp}.json`);
    if(!response.ok)throw Error('ランキングを取得できません');
    const full=await response.json();
    const compact=full.map(({speciesId,score})=>({key:normalize(speciesId),score}));
    compact.rankByKey=new Map(compact.map((item,index)=>[item.key,index]));
    return[cp,compact];
  })).then(entries=>battleRankings=Object.fromEntries(entries)).catch(error=>{
    battleRankingsPromise=null;
    throw error;
  });
  return battleRankingsPromise;
}

function battleSpeciesKey(name,form='Normal'){
  const key=normalize(form),suffix={alola:'alolan',galar:'galarian',hisui:'hisuian',paldea:'paldean'}[key]||key;
  return suffix==='normal'?normalize(name):normalize(name)+suffix;
}

function findBattleRank(list,name,form){
  const wanted=battleSpeciesKey(name,form);
  let index=list.rankByKey.get(wanted)??-1;
  if(index<0&&normalize(form)!=='normal')index=list.rankByKey.get(normalize(name))??-1;
  return index;
}

async function updateEvolutionRankings(pokemon,form){
  const container=$('evolutionRankings');
  container.textContent='進化先ランキングを取得中…';
  try{
    const [evolutions]=await Promise.all([getEvolutionTargets(pokemon),loadBattleRankings()]);
    renderEvolutionRankings(container,evolutions,form);
  }catch(error){
    container.textContent='進化先ランキングを取得できません';
    console.warn(error);
  }
}

async function getEvolutionTargets(pokemon){
  if(evolutionCache.has(pokemon.id))return evolutionCache.get(pokemon.id);
  const speciesResponse=await fetch(`https://pokeapi.co/api/v2/pokemon-species/${pokemon.id}`);
  if(!speciesResponse.ok)throw Error('進化情報を取得できません');
  const species=await speciesResponse.json();
  const chainResponse=await fetch(species.evolution_chain.url);
  if(!chainResponse.ok)throw Error('進化情報を取得できません');
  const chain=(await chainResponse.json()).chain;
  const current=findEvolutionNode(chain,pokemon.name);
  const names=current?collectEvolutionNames(current.evolves_to):[];
  const targets=names.map(name=>catalog.find(item=>normalize(item.name)===normalize(name))).filter(Boolean);
  evolutionCache.set(pokemon.id,targets);
  return targets;
}

function findEvolutionNode(node,name){
  if(normalize(node.species.name)===normalize(name))return node;
  for(const child of node.evolves_to){const found=findEvolutionNode(child,name);if(found)return found}
  return null;
}

function collectEvolutionNames(nodes){
  return nodes.flatMap(node=>[node.species.name,...collectEvolutionNames(node.evolves_to)]);
}

function renderEvolutionRankings(container,evolutions,form){
  container.replaceChildren();
  const title=document.createElement('strong');title.textContent='進化先の対戦ランキング';title.style.cssText='display:block;margin-bottom:9px';container.append(title);
  if(!evolutions.length){const empty=document.createElement('span');empty.textContent='このポケモンに進化先はありません';container.append(empty);return}
  for(const pokemon of evolutions){
    const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:10px;margin-top:8px;padding:9px;border-radius:12px;background:#fff';
    const image=document.createElement('img');image.src=pokemon.art||pokemon.sprite;image.alt='';image.style.cssText='width:44px;height:44px;object-fit:contain';
    const text=document.createElement('div'),name=document.createElement('b'),ranks=document.createElement('span');
    name.textContent=pokemon.ja;name.style.display='block';
    ranks.textContent=[['スーパー',1500],['ハイパー',2500],['マスター',10000]].map(([label,cp])=>{const index=findBattleRank(battleRankings[cp],pokemon.name,form);return`${label} ${index>=0?`${index+1}位`:'対象外'}`}).join(' ／ ');
    text.append(name,ranks);row.append(image,text);container.append(row);
  }
}
function scoreFast(m,types){const stab=types.includes(m.type)?1.2:1;return stab*((+m.power||0)/Math.max(1,+m.duration)*1000+(+m.energy_delta||0)/Math.max(1,+m.duration)*250)}
function scoreCharged(m,types){const stab=types.includes(m.type)?1.2:1;return stab*((+m.power||0)/Math.max(1,Math.abs(+m.energy_delta||100))*10+(+m.power||0)/Math.max(1,+m.duration)*1000)}
function title(s){return s.charAt(0).toUpperCase()+s.slice(1)}function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

function initCropEditor(){const c=$('cropCanvas');c.width=360;c.height=Math.round(360*currentBitmap.height/currentBitmap.width);cropRect={...DEFAULT_CROP};drawCrop();if(c.dataset.ready)return;c.dataset.ready='1';const point=e=>{const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}};c.addEventListener('pointerdown',e=>{cropStart=point(e);cropRect={x:cropStart.x,y:cropStart.y,w:.01,h:.01};c.setPointerCapture(e.pointerId);drawCrop()});c.addEventListener('pointermove',e=>{if(!cropStart)return;const p=point(e);cropRect={x:Math.max(0,Math.min(cropStart.x,p.x)),y:Math.max(0,Math.min(cropStart.y,p.y)),w:Math.min(1,Math.abs(p.x-cropStart.x)),h:Math.min(1,Math.abs(p.y-cropStart.y))};drawCrop()});c.addEventListener('pointerup',()=>{cropStart=null;if(cropRect.w<.08||cropRect.h<.08)cropRect={...DEFAULT_CROP};drawCrop()})}
function drawCrop(){const c=$('cropCanvas'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.drawImage(currentBitmap,0,0,c.width,c.height);x.fillStyle='#071b2288';x.fillRect(0,0,c.width,c.height);const r={x:cropRect.x*c.width,y:cropRect.y*c.height,w:cropRect.w*c.width,h:cropRect.h*c.height};x.save();x.beginPath();x.rect(r.x,r.y,r.w,r.h);x.clip();x.drawImage(currentBitmap,0,0,c.width,c.height);x.restore();x.strokeStyle='#00e5ff';x.lineWidth=3;x.setLineDash([9,5]);x.strokeRect(r.x,r.y,r.w,r.h)}

function analyze(bitmap){
  const w=600,h=Math.round(bitmap.height*w/bitmap.width),c=document.createElement('canvas');
  c.width=w;c.height=h;
  const x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(bitmap,0,0,w,h);
  const p=x.getImageData(0,0,w,h).data,rows=[];
  for(let y=h*.735|0;y<h*.89;y++){
    let colorFirst=-1,colorLast=-1,trackFirst=-1,trackLast=-1,colorCount=0,trackCount=0;
    for(let xx=w*.09|0;xx<w*.5;xx++){
      const i=(y*w+xx)*4,r=p[i],g=p[i+1],b=p[i+2];
      if(isBar(r,g,b)){
        if(colorFirst<0)colorFirst=xx;
        colorLast=xx;
        colorCount++;
      }
      if(xx>w*.11&&isTrack(r,g,b)){
        if(trackFirst<0)trackFirst=xx;
        trackLast=xx;
        trackCount++;
      }
    }
    const start=colorFirst>=0?colorFirst:trackFirst;
    const startsCorrectly=start>w*.105&&start<w*.15;
    const hasFullTrack=trackCount>w*.13;
    const hasLongColor=colorCount>w*.075&&colorLast-colorFirst>w*.11;
    const hasColorAndTrack=colorCount>w*.006&&hasFullTrack;
    const isZeroBar=colorCount<=w*.012&&hasFullTrack&&trackLast-trackFirst>w*.25;
    if(startsCorrectly&&(hasLongColor||hasColorAndTrack||isZeroBar)){
      rows.push({y,first:start,last:isZeroBar?Math.round(w*.118)-1:colorLast,count:colorCount,trackCount});
    }
  }
  const groups=[];
  for(const row of rows){const g=groups.at(-1);if(!g||row.y>g.at(-1).y+1)groups.push([row]);else g.push(row)}
  const bars=groups.filter(g=>g.length>=4).map(g=>g.reduce((a,b)=>b.trackCount+b.count>a.trackCount+a.count?b:a)).filter(b=>b.y>h*.75).slice(0,3);
  if(bars.length!==3)throw Error(`評価バーを3本検出できませんでした (${bars.length}本)`);
  const vals=bars.map(b=>Math.max(0,Math.min(15,Math.round(Math.max(0,Math.min(1,(b.last-w*.118+1)/(w*.465-w*.118)))*15))));
  drawPreview(bitmap,bars,h);return vals;
}
function isBar(r,g,b){return r>210&&g>105&&g<205&&b<145&&r-g>35||r>195&&g>75&&g<165&&b>75&&b<175&&r-g>45}
function isTrack(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b);return max-min<18&&r>175&&r<242}
function drawPreview(bitmap,bars,h){const o=$('preview');o.width=600;o.height=252;const x=o.getContext('2d');x.drawImage(bitmap,0,bitmap.height*.72,bitmap.width,bitmap.height*.2,0,0,o.width,o.height);x.strokeStyle='#00e5ff';x.lineWidth=3;x.setLineDash([8,5]);bars.forEach(b=>{const y=(b.y-h*.72)/(h*.2)*o.height;x.beginPath();x.moveTo(o.width*.108,y);x.lineTo(o.width*.475,y);x.stroke()})}
function showResult([attack,defense,stamina]){
  const total=attack+defense+stamina;
  currentPokemon=null;
  currentIV={attack,defense,stamina};
  $('formPicker').hidden=true;
  $('selectedPokemonArt').hidden=true;
  $('percent').textContent=`${Math.round(total/45*100)}%`;
  $('grade').textContent=gradeFor(total);
  [['attack',attack],['defense',defense],['hp',stamina]].forEach(([name,value])=>updateIvBar(name,value));
  $('picker').hidden=true;
  $('result').hidden=false;
  $('result').scrollIntoView({behavior:'smooth'});
}

function updateIvBar(name,value){
  const bar=$(`${name}Bar`);
  $(`${name}Text`).textContent=`${value} / 15`;
  bar.style.width=`${value/15*100}%`;
  bar.style.background=value===15?'#df5f69':'#f4a23f';
}

function gradeFor(total){
  if(total===45)return'4★';
  if(total>=37)return'3★';
  if(total>=30)return'2★';
  if(total>=23)return'1★';
  return'0★';
}
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js');
