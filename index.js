const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();

// Το Render δίνει αυτόματα το PORT.
// Αν τρέχει τοπικά, χρησιμοποιούμε 10000.
const PORT = process.env.PORT || 10000;

// =====================================================
// CORS
// =====================================================

// Επιτρεπόμενα Web origins
const allowedOrigins = [
    "https://apsionikoskarlovasiou-fecff.web.app",
    "https://apsionikoskarlovasiou-fecff.firebaseapp.com",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;

    let isAllowed = false;

    // Native Android / iPhone requests συνήθως δεν έχουν Origin
    if (!origin) {
        isAllowed = true;
    }

    // Firebase Hosting
    if (origin && allowedOrigins.includes(origin)) {
        isAllowed = true;
    }

    // Flutter Web τοπικά
    if (
        origin &&
        (
            origin.startsWith("http://localhost:") ||
            origin.startsWith("http://127.0.0.1:")
        )
    ) {
        isAllowed = true;
    }

    if (isAllowed && origin) {
        res.setHeader(
            "Access-Control-Allow-Origin",
            origin
        );

        res.setHeader(
            "Vary",
            "Origin"
        );
    }

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    // Απάντηση στα browser preflight requests
    if (req.method === "OPTIONS") {
        if (isAllowed) {
            return res.sendStatus(204);
        }

        return res.status(403).json({
            error: "Origin not allowed",
        });
    }

    next();
});

// =====================================================
// JSON BODY
// =====================================================

app.use(bodyParser.json());

// =====================================================
// FIREBASE SERVICE ACCOUNT
// =====================================================

// Ανάγνωση του serviceAccount από Environment Variable
const serviceAccount = JSON.parse(
    process.env.SERVICE_ACCOUNT_KEY
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// =====================================================
// WAKE / HEALTH CHECK
// =====================================================

// Αυτό καλεί το κουμπί "ΞΥΠΝΑ SERVER"
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Push backend is awake",
    });
});

// Health check για Render
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
    });
});

// =====================================================
// FIREBASE ACCESS TOKEN
// =====================================================

async function getAccessToken() {
    const SCOPES = [
        "https://www.googleapis.com/auth/firebase.messaging",
    ];

    const jwtClient = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        SCOPES
    );

    const tokens = await jwtClient.authorize();

    return tokens.access_token;
}

// =====================================================
// SEND PUSH NOTIFICATION
// =====================================================

app.post(
    "/send-notification",
    async (req, res) => {
        const {
            title,
            body,
            roles,
        } = req.body;

        if (
            !title ||
            !body ||
            !roles ||
            !Array.isArray(roles)
        ) {
            return res.status(400).json({
                error:
                    "Λείπουν πεδία ή λάθος μορφή.",
            });
        }

        try {
            const accessToken =
                await getAccessToken();

            const tokensSnapshot =
                await admin
                    .firestore()
                    .collection("deviceTokens")
                    .get();

            const usersRef =
                admin
                    .firestore()
                    .collection("users");

            const sendPromises = [];

            for (
                const doc
                of tokensSnapshot.docs
            ) {
                const token =
                    doc.data().token;

                const userId =
                    doc.id;

                const userDoc =
                    await usersRef
                        .doc(userId)
                        .get();

                const userRole =
                    userDoc.data()?.role;

                if (
                    roles.includes(
                        userRole
                    )
                ) {
                    const message = {
                        message: {
                            notification: {
                                title,
                                body,
                            },
                            token: token,
                        },
                    };

                    const response =
                        await fetch(
                            `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
                            {
                                method: "POST",

                                headers: {
                                    Authorization:
                                        `Bearer ${accessToken}`,

                                    "Content-Type":
                                        "application/json",
                                },

                                body:
                                    JSON.stringify(
                                        message
                                    ),
                            }
                        );

                    const result =
                        await response.json();

                    console.log(
                        `✅ Εστάλη στον ${userRole}:`,
                        result
                    );

                    sendPromises.push(
                        result
                    );
                }
            }

            res.json({
                success: true,
                count:
                    sendPromises.length,
            });
        } catch (error) {
            console.error(
                "❌ Σφάλμα αποστολής:",
                error
            );

            res.status(500).json({
                error:
                    "Αποτυχία αποστολής",
            });
        }
    }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `🚀 Backend FCM v1 τρέχει στο 0.0.0.0:${PORT}`
        );
    }
);
