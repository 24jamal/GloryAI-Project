import axios from "axios";
import crypto from "crypto";
import { clerkClient } from "@clerk/express";

const RAZORPAY_API_URL = "https://api.razorpay.com/v1";
const ACTIVE_STATUS = "active";

const razorpayConfig = () => ({
    auth: {
        username: process.env.RAZORPAY_KEY_ID,
        password: process.env.RAZORPAY_KEY_SECRET,
    },
});

const getRequiredEnv = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
};

const isPremiumSubscription = (subscription) => {
    const currentEnd = Number(subscription.current_end);

    // Razorpay Checkout can return successfully while the subscription is
    // still `authenticated`; Razorpay changes it to `active` asynchronously.
    // The verified authentication transaction is enough to enable access now.
    if (subscription.status === "authenticated") return true;

    return subscription.status === ACTIVE_STATUS
        && Number.isFinite(currentEnd)
        && currentEnd > Math.floor(Date.now() / 1000);
};

const fetchSubscription = async (subscriptionId) => {
    const { data } = await axios.get(
        `${RAZORPAY_API_URL}/subscriptions/${subscriptionId}`,
        razorpayConfig()
    );
    return data;
};

// Private metadata is the server-side entitlement source. Public metadata is
// only used to display the plan name in the React UI.
const saveSubscription = async (userId, subscription) => {
    const premium = isPremiumSubscription(subscription);

    await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
            razorpaySubscriptionId: subscription.id,
            razorpaySubscriptionStatus: subscription.status,
            razorpaySubscriptionCurrentEnd: subscription.current_end ?? null,
            razorpayPlanId: subscription.plan_id,
            razorpaySubscriptionSyncedAt: Date.now(),
        },
        publicMetadata: { plan: premium ? "premium" : "free" },
    });

    return premium;
};

const belongsToUser = (subscription, userId) =>
    subscription?.notes?.clerk_user_id === userId;

export const createMonthlySubscription = async (req, res) => {
    try {
        getRequiredEnv("RAZORPAY_KEY_ID");
        getRequiredEnv("RAZORPAY_KEY_SECRET");
        const planId = getRequiredEnv("RAZORPAY_MONTHLY_PLAN_ID");
        const { userId } = req;
        const user = await clerkClient.users.getUser(userId);
        const existingId = user.privateMetadata?.razorpaySubscriptionId;

        // Reuse an unfinished checkout rather than creating duplicate mandates
        // when the customer reopens the pricing page.
        if (existingId) {
            try {
                const existing = await fetchSubscription(existingId);
                if (belongsToUser(existing, userId)
                    && ["created", "authenticated", "pending", ACTIVE_STATUS].includes(existing.status)) {
                    const premium = await saveSubscription(userId, existing);
                    return res.json({
                        success: true,
                        alreadySubscribed: premium,
                        subscriptionId: existing.id,
                        key: process.env.RAZORPAY_KEY_ID,
                        prefill: {
                            name: user.fullName || "",
                            email: user.primaryEmailAddress?.emailAddress || "",
                        },
                    });
                }
            } catch (error) {
                // A removed subscription is safe to replace with a new checkout.
                if (error.response?.status !== 404) throw error;
            }
        }

        const totalCount = Number(process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT || 120);
        if (!Number.isInteger(totalCount) || totalCount < 1) {
            throw new Error("RAZORPAY_SUBSCRIPTION_TOTAL_COUNT must be a positive integer");
        }

        const { data: subscription } = await axios.post(
            `${RAZORPAY_API_URL}/subscriptions`,
            {
                plan_id: planId,
                total_count: totalCount,
                quantity: 1,
                customer_notify: false,
                notes: { clerk_user_id: userId },
            },
            razorpayConfig()
        );

        await saveSubscription(userId, subscription);

        res.status(201).json({
            success: true,
            subscriptionId: subscription.id,
            key: process.env.RAZORPAY_KEY_ID,
            prefill: {
                name: user.fullName || "",
                email: user.primaryEmailAddress?.emailAddress || "",
            },
        });
    } catch (error) {
        console.error("Unable to create Razorpay subscription:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Unable to start subscription checkout." });
    }
};

export const verifySubscriptionCheckout = async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
        const { userId } = req;
        const secret = getRequiredEnv("RAZORPAY_KEY_SECRET");

        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Incomplete Razorpay payment response." });
        }

        const user = await clerkClient.users.getUser(userId);
        if (user.privateMetadata?.razorpaySubscriptionId !== razorpay_subscription_id) {
            return res.status(403).json({ success: false, message: "Subscription does not belong to this user." });
        }

        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
            .digest("hex");

        const signatureIsValid = expectedSignature.length === razorpay_signature.length
            && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

        if (!signatureIsValid) {
            return res.status(400).json({ success: false, message: "Invalid Razorpay payment signature." });
        }

        const subscription = await fetchSubscription(razorpay_subscription_id);
        if (!belongsToUser(subscription, userId)) {
            return res.status(403).json({ success: false, message: "Subscription could not be verified." });
        }

        const premium = await saveSubscription(userId, subscription);
        res.json({
            success: true,
            active: premium,
            message: premium
                ? "Your Premium subscription is active."
                : "Payment was verified. Your plan will activate when Razorpay confirms the subscription.",
        });
    } catch (error) {
        console.error("Unable to verify Razorpay checkout:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Unable to verify subscription payment." });
    }
};

export const handleRazorpayWebhook = async (req, res) => {
    try {
        const webhookSecret = getRequiredEnv("RAZORPAY_WEBHOOK_SECRET");
        const signature = req.get("x-razorpay-signature");
        const rawBody = req.body;

        if (!signature || !Buffer.isBuffer(rawBody)) {
            return res.status(400).json({ success: false, message: "Invalid webhook request." });
        }

        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");

        const signatureIsValid = expectedSignature.length === signature.length
            && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
        if (!signatureIsValid) return res.status(400).json({ success: false, message: "Invalid webhook signature." });

        const event = JSON.parse(rawBody.toString("utf8"));
        const webhookSubscription = event.payload?.subscription?.entity;
        const userId = webhookSubscription?.notes?.clerk_user_id;

        if (!userId || !webhookSubscription?.id) return res.status(200).json({ success: true });

        // Fetching the latest entity makes this safe if Razorpay retries or
        // delivers webhook events out of order.
        const subscription = await fetchSubscription(webhookSubscription.id);
        if (!belongsToUser(subscription, userId)) {
            return res.status(400).json({ success: false, message: "Webhook subscription ownership mismatch." });
        }

        await saveSubscription(userId, subscription);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Unable to process Razorpay webhook:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Webhook processing failed." });
    }
};
