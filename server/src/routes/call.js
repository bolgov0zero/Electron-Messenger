const router = require('express').Router();
const crypto = require('crypto');
const { authMiddleware } = require('../auth');

router.get('/turn-credentials', authMiddleware, (req, res) => {
  const secret = process.env.TURN_SECRET;
  if (!secret) {
    return res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  }
  const ts = Math.floor(Date.now() / 1000) + 86400;
  const username = String(ts);
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  const host = process.env.TURN_HOST || req.hostname;
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: `turn:${host}:3478`, username, credential },
      { urls: `turn:${host}:3478?transport=tcp`, username, credential },
    ],
  });
});

module.exports = router;
