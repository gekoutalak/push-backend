const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const app = express();

// ============================================================
// 🚀 RENDER PORT
// ============================================================

const PORT = process.env.PORT || 10000;

// ============================================================
// 🌐 CORS
// ============================================================

const allowedOrigins = [
    "https://apsionikoskarlovasiou-fecff.web.app",
    "https://apsionikoskarlovasiou-fecff.firebaseapp.com",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;

    let isAllowed = false;

    // Android / native requests normally do not have Origin.
    if (!origin) {
        isAllowed = true;
    }

    // Firebase Hosting.
    if (
        origin &&
        allowedOrigins.includes(origin)
    ) {
        isAllowed = true;
    }

    // Local Flutter Web testing.
    if (
        origin &&
        (
            origin.startsWith("http://localhost:") ||
            origin.startsWith("http://127.0.0.1:")
        )
    ) {
        isAllowed = true;
    }

    if (
        isAllowed &&
        origin
    ) {
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

    // Browser preflight.
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

// ============================================================
// 📦 JSON BODY
// ============================================================

app.use(
    bodyParser.json()
);

// ============================================================
// 🔥 FIREBASE SERVICE ACCOUNT
// ============================================================

if (!process.env.SERVICE_ACCOUNT_KEY) {
    throw new Error(
        "Λείπει το Environment Variable SERVICE_ACCOUNT_KEY"
    );
}

const serviceAccount = JSON.parse(
    process.env.SERVICE_ACCOUNT_KEY
);

admin.initializeApp({
    credential: admin.credential.cert(
        serviceAccount
    ),
});

const db = admin.firestore();

// ============================================================
// ❤️ WAKE / HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        status: "ok",
        message: "Push backend is awake",
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
    });
});

// ============================================================
// 🔑 FIREBASE ACCESS TOKEN
// ============================================================

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

    const tokens =
        await jwtClient.authorize();

    return tokens.access_token;
}

// ============================================================
// 👤 NORMALIZE ROLE
// ============================================================

function normalizeRole(role) {
    if (!role) {
        return "";
    }

    const value = role
        .toString()
        .trim()
        .toLowerCase();

    switch (value) {
        case "αθλητής":
        case "athlete":
            return "athlete";

        case "γονέας":
        case "parent":
            return "parent";

        case "προπονητής":
        case "coach":
            return "coach";

        case "έφορος":
        case "eforos":
            return "eforos";

        case "διαχειριστής":
        case "admin":
            return "admin";

        case "επισκέπτης":
        case "visitor":
            return "visitor";

        default:
            return value;
    }
}

// ============================================================
// 🔐 ADMIN AUTHORIZATION
// ============================================================

async function requireAdmin(req, res, next) {
    try {
        const authHeader =
            req.headers.authorization || "";

        if (
            !authHeader.startsWith("Bearer ")
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Δεν υπάρχει έγκυρο Authorization token.",
                });
        }

        const idToken =
            authHeader
                .substring(7)
                .trim();

        if (!idToken) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Λείπει το Firebase ID token.",
                });
        }

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(idToken);

        const requesterUid =
            decodedToken.uid;

        const requesterDoc =
            await db
                .collection("users")
                .doc(requesterUid)
                .get();

        if (!requesterDoc.exists) {
            return res
                .status(403)
                .json({
                    success: false,
                    error:
                        "Δεν βρέθηκε προφίλ διαχειριστή.",
                });
        }

        const requesterData =
            requesterDoc.data() || {};

        const requesterRole =
            normalizeRole(
                requesterData.normalizedRole ||
                requesterData.role
            );

        if (requesterRole !== "admin") {
            return res
                .status(403)
                .json({
                    success: false,
                    error:
                        "Η ενέργεια επιτρέπεται μόνο σε Διαχειριστή.",
                });
        }

        req.requesterUid =
            requesterUid;

        next();
    } catch (error) {
        console.error(
            "❌ Σφάλμα ελέγχου διαχειριστή:",
            error
        );

        return res
            .status(401)
            .json({
                success: false,
                error:
                    "Μη έγκυρη ή ληγμένη σύνδεση.",
                details:
                    error.message,
            });
    }
}

// ============================================================
// 🗑️ DELETE USER
// ============================================================

app.post(
    "/delete-user",
    requireAdmin,
    async (req, res) => {
        try {
            const targetUid =
                (req.body?.uid || "")
                    .toString()
                    .trim();

            if (!targetUid) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Λείπει το uid του χρήστη.",
                    });
            }

            // Δεν επιτρέπουμε στον διαχειριστή
            // να διαγράψει τον δικό του λογαριασμό.
            if (
                targetUid ===
                req.requesterUid
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        error:
                            "Δεν μπορείτε να διαγράψετε τον δικό σας λογαριασμό.",
                    });
            }

            const userRef =
                db
                    .collection("users")
                    .doc(targetUid);

            const targetDoc =
                await userRef.get();

            if (!targetDoc.exists) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        error:
                            "Ο χρήστης δεν βρέθηκε στο Firestore.",
                    });
            }

            const targetData =
                targetDoc.data() || {};

            const firstName =
                (targetData.firstName || "")
                    .toString()
                    .trim();

            const lastName =
                (targetData.lastName || "")
                    .toString()
                    .trim();

            const fullName =
                `${firstName} ${lastName}`
                    .trim();

            const targetRole =
                normalizeRole(
                    targetData.normalizedRole ||
                    targetData.role
                );

            console.log(
                "========================================"
            );

            console.log(
                "🗑️ Διαγραφή χρήστη"
            );

            console.log(
                "Από:",
                req.requesterUid
            );

            console.log(
                "Χρήστης:",
                targetUid
            );

            console.log(
                "Όνομα:",
                fullName || "-"
            );

            console.log(
                "Ρόλος:",
                targetRole || "-"
            );

            // =================================================
            // FIREBASE AUTHENTICATION
            // =================================================

            try {
                await admin
                    .auth()
                    .deleteUser(
                        targetUid
                    );

                console.log(
                    "✅ Διαγράφηκε από Firebase Authentication"
                );
            } catch (authError) {
                // Αν ο λογαριασμός έχει ήδη διαγραφεί
                // από το Authentication, συνεχίζουμε
                // ώστε να καθαρίσουμε το Firestore.
                if (
                    authError.code ===
                    "auth/user-not-found"
                ) {
                    console.log(
                        "⚠️ Δεν υπήρχε πλέον στο Firebase Authentication"
                    );
                } else {
                    throw authError;
                }
            }

            // =================================================
            // FIRESTORE
            // =================================================

            const batch =
                db.batch();

            batch.delete(
                userRef
            );

            batch.delete(
                db
                    .collection(
                        "deviceTokens"
                    )
                    .doc(targetUid)
            );

            await batch.commit();

            console.log(
                "✅ Διαγράφηκε από users και deviceTokens"
            );

            console.log(
                "========================================"
            );

            return res
                .status(200)
                .json({
                    success: true,
                    message:
                        "Ο χρήστης διαγράφηκε επιτυχώς.",
                    uid:
                        targetUid,
                    name:
                        fullName,
                    role:
                        targetRole,
                });
        } catch (error) {
            console.error(
                "❌ Σφάλμα διαγραφής χρήστη:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    error:
                        "Αποτυχία διαγραφής χρήστη.",
                    details:
                        error.message,
                });
        }
    }
);

// ============================================================
// 📱💻 GET ALL DEVICE TOKENS
// ============================================================

function getAllDeviceTokens(data) {
    const tokenSet = new Set();

    function addToken(token) {
        if (
            typeof token === "string" &&
            token.trim().length > 0
        ) {
            tokenSet.add(
                token.trim()
            );
        }
    }

    function addTokenArray(array) {
        if (!Array.isArray(array)) {
            return;
        }

        for (const token of array) {
            addToken(token);
        }
    }

    // Legacy token.
    addToken(
        data.token
    );

    // Current token per platform.
    addToken(
        data.webToken
    );

    addToken(
        data.androidToken
    );

    // All known tokens.
    addTokenArray(
        data.tokens
    );

    addTokenArray(
        data.webTokens
    );

    addTokenArray(
        data.androidTokens
    );

    // Set removes duplicates automatically.
    return Array.from(
        tokenSet
    );
}

// ============================================================
// 📤 SEND ONE FCM MESSAGE
// ============================================================

async function sendFcmMessage({
    accessToken,
    token,
    title,
    body,
}) {
    const message = {
        message: {
            notification: {
                title,
                body,
            },

            token,

            // ================================================
            // ANDROID
            // ================================================

            android: {
                priority: "high",
            },

            // ================================================
            // WEB
            // ================================================

            webpush: {
                headers: {
                    Urgency: "high",
                },
            },
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

    let result;

    try {
        result =
            await response.json();
    } catch (e) {
        result = {
            error:
                "Δεν ήταν δυνατή η ανάγνωση της απάντησης FCM",
        };
    }

    return {
        ok:
            response.ok,

        status:
            response.status,

        result,
    };
}

// ============================================================
// 🔔 SEND PUSH NOTIFICATION
// ============================================================

app.post(
    "/send-notification",
    async (req, res) => {
        const {
            title,
            body,
            roles,
        } = req.body;

        // ====================================================
        // VALIDATION
        // ====================================================

        if (
            !title ||
            !body ||
            !roles ||
            !Array.isArray(roles) ||
            roles.length === 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    error:
                        "Λείπουν πεδία ή λάθος μορφή.",
                });
        }

        try {
            console.log(
                "========================================"
            );

            console.log(
                "🔔 Νέα Push ειδοποίηση"
            );

            console.log(
                "Τίτλος:",
                title
            );

            console.log(
                "Ρόλοι:",
                roles
            );

            // =================================================
            // ACCESS TOKEN
            // =================================================

            const accessToken =
                await getAccessToken();

            // =================================================
            // FIRESTORE
            // =================================================

            const tokensSnapshot =
                await db
                    .collection(
                        "deviceTokens"
                    )
                    .get();

            const usersRef =
                db.collection(
                    "users"
                );

            // =================================================
            // NORMALIZE SELECTED ROLES
            // =================================================

            const normalizedRoles =
                roles.map(
                    normalizeRole
                );

            // =================================================
            // COUNTERS
            // =================================================

            let matchedUsers = 0;
            let totalTokens = 0;
            let successCount = 0;
            let failureCount = 0;

            const errors = [];

            // =================================================
            // LOOP DEVICE TOKEN DOCUMENTS
            // =================================================

            for (
                const tokenDoc
                of tokensSnapshot.docs
            ) {
                const userId =
                    tokenDoc.id;

                const tokenData =
                    tokenDoc.data();

                // =============================================
                // USER DATA
                // =============================================

                const userDoc =
                    await usersRef
                        .doc(userId)
                        .get();

                if (!userDoc.exists) {
                    console.log(
                        `⚠️ Δεν βρέθηκε user document: ${userId}`
                    );

                    continue;
                }

                const userData =
                    userDoc.data() || {};

                const userRole =
                    userData.role || "";

                const normalizedUserRole =
                    normalizeRole(
                        userData.normalizedRole ||
                        userRole
                    );

                // =============================================
                // ROLE FILTER
                // =============================================

                if (
                    !normalizedRoles.includes(
                        normalizedUserRole
                    )
                ) {
                    continue;
                }

                matchedUsers++;

                // =============================================
                // GET WEB + ANDROID TOKENS
                // =============================================

                const userTokens =
                    getAllDeviceTokens(
                        tokenData
                    );

                if (
                    userTokens.length === 0
                ) {
                    console.log(
                        `⚠️ Ο χρήστης ${userId} δεν έχει FCM token`
                    );

                    continue;
                }

                console.log(
                    `👤 ${userRole} - ${userId}`
                );

                console.log(
                    `📱💻 Tokens: ${userTokens.length}`
                );

                // =============================================
                // SEND TO EVERY DEVICE
                // =============================================

                for (
                    const token
                    of userTokens
                ) {
                    totalTokens++;

                    try {
                        const sendResult =
                            await sendFcmMessage({
                                accessToken,
                                token,
                                title,
                                body,
                            });

                        if (
                            sendResult.ok
                        ) {
                            successCount++;

                            console.log(
                                `✅ Εστάλη στον ${userRole}`
                            );
                        } else {
                            failureCount++;

                            console.error(
                                `❌ Αποτυχία token για ${userRole}:`,
                                sendResult.result
                            );

                            errors.push({
                                userId,
                                role:
                                    userRole,
                                status:
                                    sendResult.status,
                                error:
                                    sendResult.result,
                            });
                        }
                    } catch (sendError) {
                        failureCount++;

                        console.error(
                            `❌ Σφάλμα αποστολής στον ${userRole}:`,
                            sendError
                        );

                        errors.push({
                            userId,
                            role:
                                userRole,
                            error:
                                sendError.message,
                        });
                    }
                }
            }

            // =================================================
            // RESULTS
            // =================================================

            console.log(
                "========================================"
            );

            console.log(
                `👥 Χρήστες: ${matchedUsers}`
            );

            console.log(
                `📱💻 Tokens: ${totalTokens}`
            );

            console.log(
                `✅ Επιτυχίες: ${successCount}`
            );

            console.log(
                `❌ Αποτυχίες: ${failureCount}`
            );

            console.log(
                "========================================"
            );

            return res.json({
                success:
                    failureCount === 0,

                matchedUsers,

                totalTokens,

                sent:
                    successCount,

                failed:
                    failureCount,

                errors,
            });
        } catch (error) {
            console.error(
                "❌ Γενικό σφάλμα αποστολής:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,

                    error:
                        "Αποτυχία αποστολής",

                    details:
                        error.message,
                });
        }
    }
);

// ============================================================
// 🚀 START SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `🚀 Backend FCM v1 τρέχει στο 0.0.0.0:${PORT}`
        );
    }
);
