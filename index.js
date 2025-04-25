const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Ανέβασε εδώ το δικό σου Firebase serviceAccountKey.json
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Ρίζα για δοκιμή
app.get('/', (req, res) => {
    res.send('Backend is working ✅');
});

// Route για αποστολή push notification
app.post('/sendNotification', async (req, res) => {
    const { title, body, token } = req.body;

    if (!token || !title || !body) {
        return res.status(400).json({ error: 'Missing title, body or token' });
    }

    const message = {
        notification: {
            title,
            body,
        },
        token,
    };

    try {
        const response = await admin.messaging().send(message);
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ξεκίνα τον server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
