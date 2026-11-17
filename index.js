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

    if (req.method === "OPTIONS") {
        if (isAllowed) {
            return res.sendStatus(204);
        }

        return res.status(403).json({
            success: false,
            error: "Origin not allowed",
        });
    }

    next();
});

// ============================================================
// 📦 JSON BODY
// ============================================================

app.use(
    bodyParser.json({
        limit: "1mb",
    })
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
        case "αθλήτρια":
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
        case "guest":
            return "visitor";

        case "pending":
            return "pending";

        default:
            return value;
    }
}

// ============================================================
// 🏐 USER CATEGORIES
// ============================================================

function getUserCategories(userData) {
    const categories = new Set();

    const rawCategories =
        userData.categories;

    if (Array.isArray(rawCategories)) {
        for (const category of rawCategories) {
            if (
                category !== null &&
                category !== undefined &&
                category.toString().trim()
            ) {
                categories.add(
                    category.toString().trim()
                );
            }
        }
    }

    const mainCategory =
        userData.mainCategory
            ?.toString()
            .trim();

    if (mainCategory) {
        categories.add(mainCategory);
    }

    const oldCategory =
        userData.category
            ?.toString()
            .trim();

    if (oldCategory) {
        categories.add(oldCategory);
    }

    return Array.from(categories);
}

// ============================================================
// 🔑 FIREBASE ACCESS TOKEN FOR FCM
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

    // Παλιό token.
    addToken(data.token);

    // Τρέχον token ανά πλατφόρμα.
    addToken(data.webToken);
    addToken(data.androidToken);

    // Πολλαπλά tokens.
    addTokenArray(data.tokens);
    addTokenArray(data.webTokens);
    addTokenArray(data.androidTokens);

    return Array.from(tokenSet);
}

// ============================================================
// 📤 SEND ONE FCM MESSAGE
// ============================================================

async function sendFcmMessage({
    accessToken,
    token,
    title,
    body,
    data,
}) {
    const message = {
        message: {
            notification: {
                title,
                body,
            },

            token,

            android: {
                priority: "high",
            },

            webpush: {
                headers: {
                    Urgency: "high",
                },
            },
        },
    };

    // Προαιρετικά extra data.
    if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data)
    ) {
        const safeData = {};

        for (
            const [key, value]
            of Object.entries(data)
        ) {
            if (
                value !== null &&
                value !== undefined
            ) {
                safeData[key] =
                    value.toString();
            }
        }

        if (
            Object.keys(safeData).length > 0
        ) {
            message.message.data =
                safeData;
        }
    }

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
                    JSON.stringify(message),
            }
        );

    let result;

    try {
        result =
            await response.json();
    } catch (_) {
        result = {
            error:
                "Δεν ήταν δυνατή η ανάγνωση της απάντησης FCM",
        };
    }

    return {
        ok: response.ok,
        status: response.status,
        result,
    };
}

// ============================================================
// 🔐 VERIFY FIREBASE USER
// ============================================================

async function verifyFirebaseUser(
    req,
    res,
    next
) {
    try {
        const authHeader =
            req.headers.authorization || "";

        if (
            !authHeader.startsWith(
                "Bearer "
            )
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Δεν υπάρχει έγκυρο token σύνδεσης.",
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
                        "Κενό token σύνδεσης.",
                });
        }

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(
                    idToken
                );

        const uid =
            decodedToken.uid;

        const userDoc =
            await db
                .collection("users")
                .doc(uid)
                .get();

        if (!userDoc.exists) {
            return res
                .status(403)
                .json({
                    success: false,
                    error:
                        "Δεν βρέθηκε ο χρήστης στο Firestore.",
                });
        }

        const userData =
            userDoc.data() || {};

        req.authUser = {
            uid,
            email:
                decodedToken.email || "",
            data:
                userData,
            role:
                normalizeRole(
                    userData.normalizedRole ||
                    userData.role
                ),
        };

        next();
    } catch (error) {
        console.error(
            "VERIFY USER ERROR:",
            error
        );

        return res
            .status(401)
            .json({
                success: false,
                error:
                    "Αποτυχία επιβεβαίωσης χρήστη.",
                details:
                    error.message,
            });
    }
}

// ============================================================
// 🔐 STAFF ONLY
// ============================================================

async function requireStaff(
    req,
    res,
    next
) {
    await verifyFirebaseUser(
        req,
        res,
        () => {
            const role =
                req.authUser?.role || "";

            if (
                role !== "admin" &&
                role !== "eforos" &&
                role !== "coach"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        error:
                            "Η λειτουργία επιτρέπεται μόνο σε Διαχειριστή, Έφορο ή Προπονητή.",
                    });
            }

            next();
        }
    );
}

// ============================================================
// 🔐 ADMIN ONLY
// ============================================================

async function requireAdmin(
    req,
    res,
    next
) {
    await verifyFirebaseUser(
        req,
        res,
        () => {
            const role =
                req.authUser?.role || "";

            if (role !== "admin") {
                return res
                    .status(403)
                    .json({
                        success: false,
                        error:
                            "Η λειτουργία επιτρέπεται μόνο στον Διαχειριστή.",
                    });
            }

            next();
        }
    );
}

// ============================================================
// 🔔 SEND PUSH BY ROLE / CATEGORY
// ============================================================

app.post(
    "/send-notification",
    async (req, res) => {
        const {
            title,
            body,
            roles,
            categories,
            data,
        } = req.body;

        if (
            !title ||
            !body ||
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

            console.log(
                "Κατηγορίες:",
                categories || []
            );

            const accessToken =
                await getAccessToken();

            const tokensSnapshot =
                await db
                    .collection(
                        "deviceTokens"
                    )
                    .get();

            const usersRef =
                db.collection("users");

            const normalizedRoles =
                roles.map(
                    normalizeRole
                );

            const selectedCategories =
                Array.isArray(categories)
                    ? categories
                        .map(
                            (item) =>
                                item
                                    .toString()
                                    .trim()
                        )
                        .filter(Boolean)
                    : [];

            let matchedUsers = 0;
            let usersWithTokens = 0;
            let totalTokens = 0;
            let successCount = 0;
            let failureCount = 0;

            const errors = [];

            for (
                const tokenDoc
                of tokensSnapshot.docs
            ) {
                const userId =
                    tokenDoc.id;

                const tokenData =
                    tokenDoc.data() || {};

                const userDoc =
                    await usersRef
                        .doc(userId)
                        .get();

                if (!userDoc.exists) {
                    continue;
                }

                const userData =
                    userDoc.data() || {};

                const normalizedUserRole =
                    normalizeRole(
                        userData.normalizedRole ||
                        userData.role
                    );

                if (
                    !normalizedRoles.includes(
                        normalizedUserRole
                    )
                ) {
                    continue;
                }

                // Αν ζητήθηκαν συγκεκριμένες
                // κατηγορίες αθλητριών.
                if (
                    normalizedUserRole ===
                        "athlete" &&
                    selectedCategories.length >
                        0
                ) {
                    const userCategories =
                        getUserCategories(
                            userData
                        );

                    const categoryMatch =
                        selectedCategories.some(
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

                const userTokens =
                    getAllDeviceTokens(
                        tokenData
                    );

                if (
                    userTokens.length === 0
                ) {
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
                                title,
                                body,
                                data,
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
            }

            return res
                .status(200)
                .json({
                    success:
                        failureCount === 0,

                    matchedUsers,

                    usersWithTokens,

                    totalTokens,

                    sent:
                        successCount,

                    failed:
                        failureCount,

                    errors,
                });
        } catch (error) {
            console.error(
                "SEND NOTIFICATION ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    error:
                        "Αποτυχία αποστολής ειδοποίησης.",
                    details:
                        error.message,
                });
        }
    }
);

// ============================================================
// 🎯 SEND PUSH TO SPECIFIC USERS
// ============================================================

app.post(
    "/send-notification-users",
    requireStaff,
    async (req, res) => {
        const {
            title,
            body,
            userIds,
            data,
        } = req.body;

        if (
            !title ||
            !body ||
            !Array.isArray(userIds) ||
            userIds.length === 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    error:
                        "Λείπουν τίτλος, μήνυμα ή παραλήπτες.",
                });
        }

        try {
            const uniqueUserIds =
                Array.from(
                    new Set(
                        userIds
                            .map(
                                (uid) =>
                                    uid
                                        ?.toString()
                                        .trim()
                            )
                            .filter(Boolean)
                    )
                );

            if (
                uniqueUserIds.length === 0
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Δεν υπάρχουν έγκυροι παραλήπτες.",
                    });
            }

            const accessToken =
                await getAccessToken();

            let matchedUsers = 0;
            let usersWithTokens = 0;
            let totalTokens = 0;
            let successCount = 0;
            let failureCount = 0;

            const errors = [];

            for (
                const userId
                of uniqueUserIds
            ) {
                const userDoc =
                    await db
                        .collection("users")
                        .doc(userId)
                        .get();

                if (!userDoc.exists) {
                    errors.push({
                        userId,
                        error:
                            "Δεν βρέθηκε user document.",
                    });

                    continue;
                }

                matchedUsers++;

                const tokenDoc =
                    await db
                        .collection(
                            "deviceTokens"
                        )
                        .doc(userId)
                        .get();

                if (!tokenDoc.exists) {
                    continue;
                }

                const userTokens =
                    getAllDeviceTokens(
                        tokenDoc.data() || {}
                    );

                if (
                    userTokens.length === 0
                ) {
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
                                title,
                                body,
                                data,
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
            }

            console.log(
                "========================================"
            );

            console.log(
                "🎯 Στοχευμένη ειδοποίηση"
            );

            console.log(
                "Αποστολέας:",
                req.authUser.uid
            );

            console.log(
                "Ρόλος:",
                req.authUser.role
            );

            console.log(
                "Χρήστες:",
                matchedUsers
            );

            console.log(
                "Με tokens:",
                usersWithTokens
            );

            console.log(
                "Επιτυχίες:",
                successCount
            );

            console.log(
                "Αποτυχίες:",
                failureCount
            );

            console.log(
                "========================================"
            );

            return res
                .status(200)
                .json({
                    success:
                        failureCount === 0,

                    matchedUsers,

                    usersWithTokens,

                    totalTokens,

                    sent:
                        successCount,

                    failed:
                        failureCount,

                    errors,
                });
        } catch (error) {
            console.error(
                "SEND NOTIFICATION USERS ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    error:
                        "Αποτυχία στοχευμένης αποστολής.",
                    details:
                        error.message,
                });
        }
    }
);

// ============================================================
// 🗑 DELETE USER
// ============================================================

app.post(
    "/delete-user",
    requireAdmin,
    async (req, res) => {
        try {
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
                            "Δεν δόθηκε UID χρήστη.",
                    });
            }

            const requesterUid =
                req.authUser.uid;

            if (
                targetUid ===
                requesterUid
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Δεν μπορείτε να διαγράψετε τον δικό σας λογαριασμό.",
                    });
            }

            // =================================================
            // USER INFO
            // =================================================

            const targetDoc =
                await db
                    .collection("users")
                    .doc(targetUid)
                    .get();

            const targetData =
                targetDoc.exists
                    ? targetDoc.data() || {}
                    : {};

            const fullName =
                `${targetData.firstName || ""} ${targetData.lastName || ""}`
                    .trim();

            const targetRole =
                normalizeRole(
                    targetData.normalizedRole ||
                    targetData.role
                );

            // =================================================
            // REMOVE REFERENCES FROM OTHER USERS
            // =================================================

            const usersSnapshot =
                await db
                    .collection("users")
                    .get();

            const batch =
                db.batch();

            for (
                const userDoc
                of usersSnapshot.docs
            ) {
                if (
                    userDoc.id ===
                    targetUid
                ) {
                    continue;
                }

                const data =
                    userDoc.data() || {};

                const updates = {};

                // -------------------------------
                // parentIds
                // -------------------------------

                if (
                    Array.isArray(
                        data.parentIds
                    ) &&
                    data.parentIds.includes(
                        targetUid
                    )
                ) {
                    updates.parentIds =
                        data.parentIds.filter(
                            (id) =>
                                id !==
                                targetUid
                        );
                }

                // -------------------------------
                // children
                // -------------------------------

                if (
                    Array.isArray(
                        data.children
                    ) &&
                    data.children.includes(
                        targetUid
                    )
                ) {
                    updates.children =
                        data.children.filter(
                            (id) =>
                                id !==
                                targetUid
                        );
                }

                // -------------------------------
                // linkedAthletes
                // -------------------------------

                if (
                    Array.isArray(
                        data.linkedAthletes
                    ) &&
                    data.linkedAthletes.includes(
                        targetUid
                    )
                ) {
                    updates.linkedAthletes =
                        data.linkedAthletes.filter(
                            (id) =>
                                id !==
                                targetUid
                        );
                }

                if (
                    Object.keys(
                        updates
                    ).length >
                    0
                ) {
                    batch.update(
                        userDoc.ref,
                        updates
                    );
                }
            }

            // =================================================
            // DELETE USER FIRESTORE DOC
            // =================================================

            batch.delete(
                db
                    .collection("users")
                    .doc(targetUid)
            );

            // =================================================
            // DELETE DEVICE TOKENS
            // =================================================

            batch.delete(
                db
                    .collection(
                        "deviceTokens"
                    )
                    .doc(targetUid)
            );

            await batch.commit();

            // =================================================
            // FIREBASE AUTH
            // =================================================

            try {
                await admin
                    .auth()
                    .deleteUser(
                        targetUid
                    );
            } catch (error) {
                // Αν έχει ήδη διαγραφεί από Authentication,
                // θεωρούμε τη διαδικασία επιτυχημένη.
                if (
                    error.code !==
                    "auth/user-not-found"
                ) {
                    throw error;
                }
            }

            console.log(
                "========================================"
            );

            console.log(
                "🗑 USER DELETED"
            );

            console.log(
                "UID:",
                targetUid
            );

            console.log(
                "Όνομα:",
                fullName
            );

            console.log(
                "Ρόλος:",
                targetRole
            );

            console.log(
                "Από:",
                requesterUid
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
                "DELETE USER ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,

                    error:
                        error.message ||
                        "Αποτυχία διαγραφής χρήστη.",
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
