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

        default:
            return value;
    }
}

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
// 🔐 VERIFY STAFF CALLER
// ============================================================

async function verifyStaffCaller(req) {
    const authorization =
        req.headers.authorization || "";

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {
        const error =
            new Error(
                "Missing Firebase ID token"
            );

        error.statusCode =
            401;

        throw error;
    }

    const idToken =
        authorization
            .substring(
                "Bearer ".length
            )
            .trim();

    if (!idToken) {
        const error =
            new Error(
                "Missing Firebase ID token"
            );

        error.statusCode =
            401;

        throw error;
    }

    const decodedToken =
        await admin.auth()
            .verifyIdToken(
                idToken
            );

    const callerDoc =
        await db.collection(
            "users"
        )
            .doc(
                decodedToken.uid
            )
            .get();

    if (!callerDoc.exists) {
        const error =
            new Error(
                "Caller user document not found"
            );

        error.statusCode =
            403;

        throw error;
    }

    const callerData =
        callerDoc.data() || {};

    const callerRole =
        normalizeRole(
            callerData.normalizedRole ||
            callerData.role ||
            ""
        );

    if (
        callerRole !== "admin" &&
        callerRole !== "eforos"
    ) {
        const error =
            new Error(
                "Not allowed"
            );

        error.statusCode =
            403;

        throw error;
    }

    return {
        uid:
            decodedToken.uid,

        email:
            decodedToken.email || "",

        role:
            callerRole,
    };
}

// ============================================================
// 🎯 SEND PUSH TO SPECIFIC USERS
// ============================================================

app.post(
    "/send-notification-users",
    async (req, res) => {
        try {
            const caller =
                await verifyStaffCaller(
                    req
                );

            const {
                title,
                body,
                userIds,
            } = req.body || {};

            if (
                typeof title !== "string" ||
                title.trim().length === 0 ||
                typeof body !== "string" ||
                body.trim().length === 0 ||
                !Array.isArray(
                    userIds
                ) ||
                userIds.length === 0
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            "Λείπουν τίτλος, μήνυμα ή παραλήπτες.",
                    });
            }

            // Αφαιρούμε κενά, διπλότυπα
            // και περιορίζουμε το μέγεθος ενός request.
            const uniqueUserIds =
                Array.from(
                    new Set(
                        userIds
                            .map(
                                (value) =>
                                    typeof value ===
                                    "string"
                                        ? value.trim()
                                        : ""
                            )
                            .filter(
                                (value) =>
                                    value.length >
                                    0
                            )
                    )
                );

            if (
                uniqueUserIds.length ===
                0
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            "Δεν υπάρχουν έγκυροι παραλήπτες.",
                    });
            }

            if (
                uniqueUserIds.length >
                300
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            "Πάρα πολλοί παραλήπτες σε μία αποστολή.",
                    });
            }

            const accessToken =
                await getAccessToken();

            let matchedUsers =
                0;

            let usersWithTokens =
                0;

            let totalTokens =
                0;

            let successCount =
                0;

            let failureCount =
                0;

            const skippedUsers =
                [];

            const errors =
                [];

            for (
                const userId
                of uniqueUserIds
            ) {
                try {
                    const userDoc =
                        await db
                            .collection(
                                "users"
                            )
                            .doc(
                                userId
                            )
                            .get();

                    if (
                        !userDoc.exists
                    ) {
                        skippedUsers.push({
                            userId,
                            reason:
                                "user_not_found",
                        });

                        continue;
                    }

                    const userData =
                        userDoc.data() ||
                        {};

                    const status =
                        (
                            userData.status ||
                            ""
                        )
                            .toString()
                            .trim()
                            .toLowerCase();

                    const normalizedRole =
                        normalizeRole(
                            userData.normalizedRole ||
                            userData.role ||
                            ""
                        );

                    // Δεν στέλνουμε ποτέ
                    // σε pending/rejected χρήστες.
                    if (
                        status ===
                            "pending" ||
                        status ===
                            "rejected" ||
                        normalizedRole ===
                            "pending"
                    ) {
                        skippedUsers.push({
                            userId,
                            reason:
                                "inactive_user",
                        });

                        continue;
                    }

                    // Η λειτουργία οφειλών
                    // αφορά μόνο Γονείς/Αθλητές.
                    if (
                        normalizedRole !==
                            "parent" &&
                        normalizedRole !==
                            "athlete"
                    ) {
                        skippedUsers.push({
                            userId,
                            reason:
                                "unsupported_role",
                        });

                        continue;
                    }

                    matchedUsers++;

                    const tokenDoc =
                        await db
                            .collection(
                                "deviceTokens"
                            )
                            .doc(
                                userId
                            )
                            .get();

                    if (
                        !tokenDoc.exists
                    ) {
                        skippedUsers.push({
                            userId,
                            reason:
                                "no_token_document",
                        });

                        continue;
                    }

                    const userTokens =
                        getAllDeviceTokens(
                            tokenDoc.data() ||
                            {}
                        );

                    if (
                        userTokens.length ===
                        0
                    ) {
                        skippedUsers.push({
                            userId,
                            reason:
                                "no_tokens",
                        });

                        continue;
                    }

                    usersWithTokens++;

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
                                    title:
                                        title.trim(),
                                    body:
                                        body.trim(),
                                });

                            if (
                                sendResult.ok
                            ) {
                                successCount++;
                            } else {
                                failureCount++;

                                errors.push({
                                    userId,
                                    status:
                                        sendResult.status,
                                    error:
                                        sendResult.result,
                                });
                            }
                        } catch (
                            sendError
                        ) {
                            failureCount++;

                            errors.push({
                                userId,
                                error:
                                    sendError.message,
                            });
                        }
                    }
                } catch (
                    userError
                ) {
                    failureCount++;

                    errors.push({
                        userId,
                        error:
                            userError.message,
                    });
                }
            }

            console.log(
                "========================================"
            );

            console.log(
                "💳 Στοχευμένη ειδοποίηση οφειλών"
            );

            console.log(
                "Αποστολέας:",
                caller.uid,
                caller.role
            );

            console.log(
                `Παραλήπτες request: ${uniqueUserIds.length}`
            );

            console.log(
                `Χρήστες που ταίριαξαν: ${matchedUsers}`
            );

            console.log(
                `Χρήστες με tokens: ${usersWithTokens}`
            );

            console.log(
                `Tokens: ${totalTokens}`
            );

            console.log(
                `Επιτυχίες: ${successCount}`
            );

            console.log(
                `Αποτυχίες: ${failureCount}`
            );

            console.log(
                "========================================"
            );

            return res.json({
                success:
                    failureCount === 0,

                requestedUsers:
                    uniqueUserIds.length,

                matchedUsers,

                usersWithTokens,

                totalTokens,

                sent:
                    successCount,

                failed:
                    failureCount,

                skippedUsers,

                errors,
            });
        } catch (error) {
            console.error(
                "❌ Σφάλμα στοχευμένης αποστολής:",
                error
            );

            return res
                .status(
                    error.statusCode ||
                    500
                )
                .json({
                    success:
                        false,

                    error:
                        error.message ||
                        "Αποτυχία αποστολής",
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
