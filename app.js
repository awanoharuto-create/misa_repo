const $ = (id) => document.getElementById(id);
const fileInput = $('file');

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const values = analyze(bitmap);
    showResult(values);
  } catch (error) {
    alert('画像を読み取れませんでした。スクリーンショットを選び直してください。');
    console.error(error);
  }
});

$('again').addEventListener('click', () => {
  fileInput.value = '';
  $('result').hidden = true;
  $('picker').hidden = false;
  scrollTo({top: 0, behavior: 'smooth'});
});

function analyze(bitmap) {
  // The appraisal panel scales with screen width. Work at a fixed width so
  // thresholds behave identically across iPhone resolutions.
  const width = 600;
  const height = Math.round(bitmap.height * width / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(bitmap, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  const candidates = [];
  const yMin = Math.floor(height * .735);
  const yMax = Math.floor(height * .89);
  const xMin = Math.floor(width * .09);
  const xMax = Math.floor(width * .50);

  for (let y = yMin; y < yMax; y++) {
    let first = -1, last = -1, count = 0;
    for (let x = xMin; x < xMax; x++) {
      const i = (y * width + x) * 4;
      if (isBarColor(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) {
        if (first < 0) first = x;
        last = x;
        count++;
      }
    }
    if (first > width * .105 && first < width * .15 && count > width * .075 && last - first > width * .11) {
      candidates.push({y, first, last, count});
    }
  }

  const groups = [];
  for (const row of candidates) {
    const group = groups.at(-1);
    if (!group || row.y > group.at(-1).y + 1) groups.push([row]);
    else group.push(row);
  }

  const bars = groups
    .filter(g => g.length >= 4)
    .map(g => g.reduce((best, row) => row.count > best.count ? row : best))
    .filter(b => b.y > height * .75)
    .slice(0, 3);

  if (bars.length !== 3) throw new Error(`評価バーを3本検出できませんでした (${bars.length})`);

  const trackEnd = width * .465;
  const values = bars.map(bar => {
    const start = width * .118;
    const ratio = Math.max(0, Math.min(1, (bar.last - start + 1) / (trackEnd - start)));
    return Math.max(0, Math.min(15, Math.round(ratio * 15)));
  });

  drawPreview(bitmap, bars, width, height);
  return values;
}

function isBarColor(r, g, b) {
  const orange = r > 210 && g > 105 && g < 205 && b < 145 && r - g > 35;
  const pink = r > 195 && g > 75 && g < 165 && b > 75 && b < 175 && r - g > 45;
  return orange || pink;
}

function drawPreview(bitmap, bars, sampleWidth, sampleHeight) {
  const out = $('preview');
  out.width = 600;
  out.height = Math.round(600 * .42);
  const ctx = out.getContext('2d');
  const cropTop = sampleHeight * .72;
  const cropHeight = sampleHeight * .20;
  ctx.drawImage(bitmap, 0, bitmap.height * .72, bitmap.width, bitmap.height * .20, 0, 0, out.width, out.height);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 5]);
  for (const bar of bars) {
    const y = (bar.y - cropTop) / cropHeight * out.height;
    ctx.beginPath();
    ctx.moveTo(out.width * .108, y);
    ctx.lineTo(out.width * .475, y);
    ctx.stroke();
  }
}

function showResult([attack, defense, hp]) {
  const total = attack + defense + hp;
  const percent = Math.round(total / 45 * 100);
  $('percent').textContent = `${percent}%`;
  $('grade').textContent = total === 45 ? '4★' : total >= 37 ? '3★' : total >= 30 ? '2★' : total >= 23 ? '1★' : '0★';
  for (const [name, value] of [['attack', attack], ['defense', defense], ['hp', hp]]) {
    $(`${name}Text`).textContent = `${value} / 15`;
    $(`${name}Bar`).style.width = `${value / 15 * 100}%`;
  }
  $('picker').hidden = true;
  $('result').hidden = false;
  $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js');
}
