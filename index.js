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

    // Android / native requests συνήθως δεν έχουν Origin.
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

    // Local Flutter Web.
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
        success: true,
        status: "ok",
    });
});

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
// 🏐 NORMALIZE CATEGORY
// ============================================================

function normalizeCategory(category) {
    if (!category) {
        return "";
    }

    return category
        .toString()
        .trim()
        .toLocaleLowerCase("el-GR");
}

// ============================================================
// 🏐 GET ALL USER CATEGORIES
// ============================================================

function getUserCategories(userData) {
    const categorySet = new Set();

    function addCategory(value) {
        const normalized =
            normalizeCategory(value);

        if (normalized) {
            categorySet.add(
                normalized
            );
        }
    }

    // Πολλαπλές κατηγορίες
    if (
        Array.isArray(
            userData.categories
        )
    ) {
        for (
            const category
            of userData.categories
        ) {
            addCategory(
                category
            );
        }
    }

    // Νέο βασικό πεδίο
    addCategory(
        userData.mainCategory
    );

    // Παλιό πεδίο
    addCategory(
        userData.category
    );

    return Array.from(
        categorySet
    );
}

// ============================================================
// 🔑 FIREBASE ACCESS TOKEN
// ============================================================

async function getAccessToken() {
    const SCOPES = [
        "https://www.googleapis.com/auth/firebase.messaging",
    ];

    const jwtClient =
        new google.auth.JWT(
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
// 📱💻 GET ALL DEVICE TOKENS
// ============================================================

function getAllDeviceTokens(data) {
    const tokenSet =
        new Set();

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

    // Legacy
    addToken(
        data.token
    );

    // Current platform tokens
    addToken(
        data.webToken
    );

    addToken(
        data.androidToken
    );

    // Token lists
    addTokenArray(
        data.tokens
    );

    addTokenArray(
        data.webTokens
    );

    addTokenArray(
        data.androidTokens
    );

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

            // ==================================================
            // ANDROID
            // ==================================================

            android: {
                priority: "high",
            },

            // ==================================================
            // WEB / iPHONE PWA
            // ==================================================

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
// 🔐 REQUIRE ADMIN
// ============================================================

async function requireAdmin(
    req,
    res,
    next
) {
    try {
        const authorization =
            req.headers.authorization || "";

        if (
            !authorization.startsWith(
                "Bearer "
            )
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Λείπει Firebase ID token.",
                });
        }

        const idToken =
            authorization
                .substring(7)
                .trim();

        if (!idToken) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Κενό Firebase ID token.",
                });
        }

        const decodedToken =
            await admin.auth()
                .verifyIdToken(
                    idToken
                );

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
                        "Δεν βρέθηκε ο χρήστης που κάνει το αίτημα.",
                });
        }

        const requesterData =
            requesterDoc.data() || {};

        const requesterRole =
            normalizeRole(
                requesterData.normalizedRole ||
                requesterData.role
            );

        if (
            requesterRole !== "admin"
        ) {
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
            "❌ requireAdmin error:",
            error
        );

        return res
            .status(401)
            .json({
                success: false,
                error:
                    "Μη έγκυρη ή ληγμένη σύνδεση.",
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
        const targetUid =
            req.body?.uid
                ?.toString()
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

        if (
            targetUid ===
            req.requesterUid
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    error:
                        "Δεν μπορείς να διαγράψεις τον δικό σου λογαριασμό από εδώ.",
                });
        }

        try {
            const targetDoc =
                await db
                    .collection("users")
                    .doc(targetUid)
                    .get();

            const targetData =
                targetDoc.exists
                    ? targetDoc.data() || {}
                    : {};

            console.log(
                "========================================"
            );

            console.log(
                "🗑️ Διαγραφή χρήστη"
            );

            console.log(
                "Requester UID:",
                req.requesterUid
            );

            console.log(
                "Target UID:",
                targetUid
            );

            console.log(
                "Target name:",
                `${targetData.firstName || ""} ${targetData.lastName || ""}`.trim()
            );

            console.log(
                "Role:",
                targetData.role || ""
            );

            // ==================================================
            // DELETE FROM FIREBASE AUTH
            // ==================================================

            try {
                await admin.auth()
                    .deleteUser(
                        targetUid
                    );

                console.log(
                    "✅ Διαγράφηκε από Firebase Authentication"
                );
            } catch (authError) {
                if (
                    authError.code !==
                    "auth/user-not-found"
                ) {
                    throw authError;
                }

                console.log(
                    "⚠️ Δεν υπήρχε πλέον στο Firebase Authentication"
                );
            }

            // ==================================================
            // DELETE FIRESTORE USER + TOKENS
            // ==================================================

            const batch =
                db.batch();

            batch.delete(
                db.collection("users")
                    .doc(targetUid)
            );

            batch.delete(
                db.collection("deviceTokens")
                    .doc(targetUid)
            );

            await batch.commit();

            console.log(
                "✅ Διαγράφηκε από users και deviceTokens"
            );

            return res.json({
                success: true,
                message:
                    "Ο χρήστης διαγράφηκε.",
            });
        } catch (error) {
            console.error(
                "❌ Delete user error:",
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
// 🔔 SEND PUSH NOTIFICATION
// ============================================================

app.post(
    "/send-notification",
    async (req, res) => {
        const {
            title,
            body,
            roles,
            categories,
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

        if (
            categories != null &&
            !Array.isArray(categories)
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    error:
                        "Το categories πρέπει να είναι λίστα.",
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

            console.log(
                "Κατηγορίες αθλητριών:",
                categories || []
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
            // NORMALIZE ROLES
            // =================================================

            const normalizedRoles =
                roles
                    .map(
                        normalizeRole
                    )
                    .filter(
                        Boolean
                    );

            // =================================================
            // NORMALIZE ATHLETE CATEGORIES
            // =================================================

            const normalizedCategories =
                Array.isArray(categories)
                    ? categories
                        .map(
                            normalizeCategory
                        )
                        .filter(
                            Boolean
                        )
                    : [];

            // =================================================
            // COUNTERS
            // =================================================

            let matchedUsers = 0;
            let totalTokens = 0;
            let successCount = 0;
            let failureCount = 0;

            const errors = [];

            // =================================================
            // LOOP DEVICE TOKENS
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
                // GET USER
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

                // =============================================
                // 🏐 ATHLETE CATEGORY FILTER
                // =============================================
                //
                // categories = []:
                //   Στέλνει σε ΟΛΟΥΣ τους αθλητές.
                //
                // categories = ["Κορασίδες"]:
                //   Στέλνει μόνο στις Κορασίδες.
                //
                // categories = ["Κορασίδες", "Νεάνιδες"]:
                //   Στέλνει και στις δύο κατηγορίες.
                //
                // Το φίλτρο εφαρμόζεται ΜΟΝΟ στους Αθλητές.
                //
                // Αν μαζί έχουμε π.χ.
                // Αθλητές + Προπονητές:
                //
                // οι αθλητές φιλτράρονται ανά κατηγορία,
                // οι προπονητές παίρνουν όλοι το Push.
                // =============================================

                if (
                    normalizedUserRole ===
                        "athlete" &&
                    normalizedCategories.length > 0
                ) {
                    const userCategories =
                        getUserCategories(
                            userData
                        );

                    const categoryMatch =
                        normalizedCategories
                            .some(
                                (category) =>
                                    userCategories.includes(
                                        category
                                    )
                            );

                    if (!categoryMatch) {
                        continue;
                    }
                }

                matchedUsers++;

                // =============================================
                // GET ALL TOKENS
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

                if (
                    normalizedUserRole ===
                    "athlete"
                ) {
                    console.log(
                        "🏐 Κατηγορίες:",
                        getUserCategories(
                            userData
                        )
                    );
                }

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

                roles,

                categories:
                    categories || [],

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
