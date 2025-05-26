const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const CLIP_DIR = path.join(DOWNLOAD_DIR, 'clips');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
if (!fs.existsSync(CLIP_DIR)) fs.mkdirSync(CLIP_DIR);

app.use('/clips', express.static(CLIP_DIR));

function getVideoDuration(url) {
  return new Promise((resolve, reject) => {
    const cmd = `yt-dlp --skip-download --print-json "${url}"`;
    exec(cmd, (err, stdout) => {
      if (err) return reject(err);
      try {
        const json = JSON.parse(stdout);
        resolve(json.duration);
      } catch (e) {
        reject(e);
      }
    });
  });
}

app.post('/clip', async (req, res) => {
  const { url } = req.body;
  const videoId = Date.now();

  console.log('Requested URL:', url);

  try {
    const duration = await getVideoDuration(url);
    console.log('Video Duration:', duration);

    if (!duration) return res.status(400).send('Cannot get video duration');

    const videoPath = path.join(DOWNLOAD_DIR, `video_${videoId}.mp4`);
    const downloadCmd = `yt-dlp -f best -o "${videoPath}" "${url}"`;

    console.log('Downloading video...');
    exec(downloadCmd, async (downloadErr) => {
      if (downloadErr) {
        console.error('Download error:', downloadErr);
        return res.status(500).send('Failed to download video');
      }

      const clipDuration = 30;
      const clips = [];
      let currentStart = 0;
      let clipCount = 0;

      while (currentStart < duration) {
        let clipStart = currentStart;
        let clipEnd = Math.min(clipStart + clipDuration, duration);

        const clipFile = path.join(CLIP_DIR, `clip_${videoId}_${clipCount}.mp4`);
        clips.push({
          start: clipStart,
          end: clipEnd,
          filename: `clip_${videoId}_${clipCount}.mp4`,
          filepath: clipFile,
        });

        currentStart += clipDuration;
        clipCount++;
      }

      const createClip = (clip) => {
        return new Promise((resolve, reject) => {
          const cmd = `ffmpeg -y -i "${videoPath}" -ss ${clip.start} -to ${clip.end} -c copy "${clip.filepath}"`;
          console.log(`Running ffmpeg: ${cmd}`);
          exec(cmd, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      };

      try {
        for (const clip of clips) {
          console.log(`Creating clip from ${clip.start} to ${clip.end} at ${clip.filepath}`);
          await createClip(clip);
        }

        fs.unlinkSync(videoPath);

        const baseUrl = `${req.protocol}://${req.get('host')}/clips`;
        const responseClips = clips.map(c => ({
          start: c.start,
          end: c.end,
          url: `${baseUrl}/${c.filename}`,
        }));

        res.json({ clips: responseClips });
      } catch (err) {
        console.error('Clip creation error:', err);
        res.status(500).send('Failed to create clips');
      }
    });
  } catch (err) {
    console.error('Video info error:', err);
    res.status(500).send('Failed to get video info');
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
