// Convert frames/xxxx.png -> video.mp4 using fluent-ffmpeg
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();


const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const FRAME_DIR = path.join(OUTPUT_DIR, 'frames');
const OUTFILE = path.join(OUTPUT_DIR, 'final_video.mp4');
const FPS = parseInt(process.env.FRAME_RATE || '30');


function render() {
if (!fs.existsSync(FRAME_DIR)) { console.error('No frames found', FRAME_DIR); process.exit(1); }


return new Promise((resolve, reject) => {
ffmpeg()
.input(path.join(FRAME_DIR, '%06d.png'))
.inputOptions(['-framerate ' + FPS])
.outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-crf 20'])
.on('progress', p => { if (p.percent) console.log('render progress', p.percent.toFixed(2)); })
.on('end', () => { console.log('Rendered', OUTFILE); resolve(); })
.on('error', err => { reject(err); })
.save(OUTFILE);
});
}


render().catch(err => { console.error(err); process.exit(1); });