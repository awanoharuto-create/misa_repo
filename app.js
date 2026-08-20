const $=id=>document.getElementById(id),fileInput=$('file');
const MOVE_SETS={
'ピカチュウ':['でんきショック','ワイルドボルト／なみのり','小回りの利く技でシールドを揺さぶろう。'],
'リザードン':['つばさでうつ※限定','ブラストバーン※限定／ドラゴンクロー','スーパー・ハイパーリーグ向けの定番構成。'],
'カメックス':['みずでっぽう','ハイドロカノン※限定／れいとうビーム','耐久を活かすPvP構成。'],
'フシギバナ':['つるのムチ','ハードプラント※限定／ヘドロばくだん','みず・じめん・フェアリーに強い構成。'],
'ゲンガー':['シャドークロー','シャドーボール／ヘドロばくだん','高火力。シールドを残して使おう。'],
'カイリュー':['りゅうのいぶき','ドラゴンクロー／ばかぢから','マスターリーグ向けの定番構成。'],
'ミュウツー':['サイコカッター','サイコブレイク※限定／シャドーボール※限定','レイド・マスターリーグで高火力。'],
'レックウザ':['ドラゴンテール','ワイドブレイカー※限定／ガリョウテンセイ','相手に合わせてドラゴン・ひこうを使い分ける。'],
'グラードン':['マッドショット','だんがいのつるぎ※限定／ほのおのパンチ※限定','素早くゲージ技を回せる構成。'],
'カイオーガ':['たきのぼり','こんげんのはどう※限定／なみのり','レイド・マスターリーグ向け。'],
'ガブリアス':['マッドショット','だいちのちから※限定／げきりん','じめんとドラゴンを使い分けられる。'],
'メタグロス':['バレットパンチ','コメットパンチ※限定／じしん','レイド・マスターリーグで優秀。'],
'マリルリ':['あわ','れいとうビーム／じゃれつく','スーパーリーグの高耐久型。'],
'チルタリス':['りゅうのいぶき','ゴッドバード／ムーンフォース※限定','通常技と軽いゲージ技で押す。'],
'ブラッキー':['バークアウト','イカサマ／とっておき※限定','高耐久のスーパー・ハイパーリーグ向け。'],
'ラグラージ':['マッドショット','ハイドロカノン※限定／じしん','高速でゲージ技を連発できる。'],
'ファイアロー':['やきつくす','ニトロチャージ／そらをとぶ','攻撃を上げて後半の圧力を高める。'],
'ギラティナ':['シャドークロー','ドラゴンクロー／かげうち','アナザーフォルムのハイパーリーグ向け。'],
'ディアルガ':['りゅうのいぶき','アイアンヘッド／りゅうせいぐん','マスターリーグ向け。通常技の削りが強力。'],
'ドオー':['どくばり','ヘドロばくだん／ストーンエッジ','スーパーリーグ向けの高耐久構成。'],
'コノヨザル':['カウンター','シャドーボール／れいとうパンチ','幅広い相手に打点を持てる。']};
const NAMES=Object.keys(MOVE_SETS);NAMES.forEach(n=>{const o=document.createElement('option');o.value=n;$('pokemonList').append(o)});
fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];if(!file)return;try{const bitmap=await createImageBitmap(file);showResult(analyze(bitmap));await identify(file,bitmap)}catch(e){alert('評価バーを読み取れませんでした。ポケモン名と3本のバーが見える画像を選んでください。');console.error(e)}});
$('pokemonSelect').addEventListener('input',e=>{const n=findName(e.target.value);if(n)setPokemon(n,'手動選択')});
$('again').addEventListener('click',()=>{fileInput.value='';$('result').hidden=true;$('picker').hidden=false;$('moves').hidden=true;scrollTo({top:0,behavior:'smooth'})});
async function identify(file,bitmap){$('pokemonName').textContent='判定中…';let name=findName(file.name);if(!name&&'TextDetector'in window)try{const blocks=await new TextDetector().detect(bitmap);name=findName(blocks.map(x=>x.rawValue).join(' '))}catch(e){console.warn(e)}if(name)setPokemon(name,'画像から推定');else{$('pokemonName').textContent='名前を選んでください';$('recognition').textContent='自動判定できませんでした';$('nameFallback').hidden=false}}
function findName(text){const s=String(text).replace(/[\s・･_\-()（）]/g,'').toLowerCase();return NAMES.find(n=>s.includes(n.toLowerCase()))}
function setPokemon(name,source){$('pokemonName').textContent=name;$('recognition').textContent=source;$('pokemonSelect').value=name;$('nameFallback').hidden=false;const m=MOVE_SETS[name];$('moveTitle').textContent=`${name}を活かすなら`;$('fastMove').textContent=m[0];$('chargedMoves').textContent=m[1];$('moveNote').textContent=m[2];$('moves').hidden=false}
function analyze(bitmap){const w=600,h=Math.round(bitmap.height*w/bitmap.width),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bitmap,0,0,w,h);const p=x.getImageData(0,0,w,h).data,rows=[];for(let y=h*.735|0;y<h*.89;y++){let first=-1,last=-1,count=0;for(let xx=w*.09|0;xx<w*.5;xx++){const i=(y*w+xx)*4;if(isBar(p[i],p[i+1],p[i+2])){if(first<0)first=xx;last=xx;count++}}if(first>w*.105&&first<w*.15&&count>w*.075&&last-first>w*.11)rows.push({y,first,last,count})}const groups=[];for(const row of rows){const g=groups.at(-1);if(!g||row.y>g.at(-1).y+1)groups.push([row]);else g.push(row)}const bars=groups.filter(g=>g.length>=4).map(g=>g.reduce((a,b)=>b.count>a.count?b:a)).filter(b=>b.y>h*.75).slice(0,3);if(bars.length!==3)throw Error(`評価バー: ${bars.length}本`);const vals=bars.map(b=>Math.max(0,Math.min(15,Math.round(Math.max(0,Math.min(1,(b.last-w*.118+1)/(w*.465-w*.118)))*15))));drawPreview(bitmap,bars,h);return vals}
function isBar(r,g,b){return r>210&&g>105&&g<205&&b<145&&r-g>35||r>195&&g>75&&g<165&&b>75&&b<175&&r-g>45}
function drawPreview(bitmap,bars,h){const o=$('preview');o.width=600;o.height=252;const x=o.getContext('2d');x.drawImage(bitmap,0,bitmap.height*.72,bitmap.width,bitmap.height*.2,0,0,o.width,o.height);x.strokeStyle='#00e5ff';x.lineWidth=3;x.setLineDash([8,5]);bars.forEach(b=>{const y=(b.y-h*.72)/(h*.2)*o.height;x.beginPath();x.moveTo(o.width*.108,y);x.lineTo(o.width*.475,y);x.stroke()})}
function showResult([a,d,h]){const total=a+d+h;$('percent').textContent=`${Math.round(total/45*100)}%`;$('grade').textContent=total===45?'4★':total>=37?'3★':total>=30?'2★':total>=23?'1★':'0★';[['attack',a],['defense',d],['hp',h]].forEach(([n,v])=>{$(`${n}Text`).textContent=`${v} / 15`;$(`${n}Bar`).style.width=`${v/15*100}%`});$('picker').hidden=true;$('result').hidden=false;$('result').scrollIntoView({behavior:'smooth'})}
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js');
