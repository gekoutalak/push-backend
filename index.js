const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendPushNotification = functions.https.onRequest(async (req, res) => {
    try {
        const { title, body, roles } = req.body;

        const tokensSnapshot = await admin.firestore()
            .collection("deviceTokens")
            .where("role", "in", roles)
            .get();

        const tokens = tokensSnapshot.docs.map(doc => doc.data().token).filter(Boolean);

        if (tokens.length === 0) {
            return res.status(404).send("❗ Δεν βρέθηκαν tokens");
        }

        const message = {
            notification: { title, body },
            tokens,
        };

        const response = await admin.messaging().sendMulticast(message);
        return res.status(200).send(`✅ Ειδοποιήσεις εστάλησαν: ${response.successCount} επιτυχίες`);
    } catch (error) {
        console.error("❌ Σφάλμα:", error);
        return res.status(500).send("❌ Σφάλμα αποστολής");
    }
});
