const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fetch = require("node-fetch");
const app = express();
const port = process.env.PORT || 3000;

// 🚀 Ανάγνωση του serviceAccount από Environment Variable
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});


app.use(bodyParser.json());

async function getAccessToken() {
    const SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"];
    const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        SCOPES
    );
    const tokens = await jwtClient.authorize();
    return tokens.access_token;
}

app.post("/send-notification", async (req, res) => {
    const { title, body, roles } = req.body;

    if (!title || !body || !roles || !Array.isArray(roles)) {
        return res.status(400).json({ error: "Λείπουν πεδία ή λάθος μορφή." });
    }

    try {
        const accessToken = await getAccessToken();

        const tokensSnapshot = await admin.firestore().collection("deviceTokens").get();
        const usersRef = admin.firestore().collection("users");

        const sendPromises = [];

        for (const doc of tokensSnapshot.docs) {
            const token = doc.data().token;
            const userId = doc.id;

            const userDoc = await usersRef.doc(userId).get();
            const userRole = userDoc.data()?.role;

            if (roles.includes(userRole)) {
                const message = {
                    message: {
                        notification: {
                            title,
                            body,
                        },
                        token: token,
                    },
                };

                const response = await fetch(
                    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(message),
                    }
                );

                const result = await response.json();
                console.log(`✅ Εστάλη στον ${userRole}:`, result);
                sendPromises.push(result);
            }
        }

        res.json({ success: true, count: sendPromises.length });
    } catch (error) {
        console.error("❌ Σφάλμα αποστολής:", error);
        res.status(500).json({ error: "Αποτυχία αποστολής" });
    }
});

app.listen(port, () => {
    console.log(`🚀 Backend FCM v1 τρέχει στο http://localhost:${port}`);
});
