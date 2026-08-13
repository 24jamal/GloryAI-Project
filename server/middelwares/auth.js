// Middleware to check userId and Razorpay-backed subscription entitlement.

import { clerkClient, getAuth } from "@clerk/express";

export const auth = async (req, res, next) => {

    try {
        const { isAuthenticated, userId } = getAuth(req);
        if (!isAuthenticated || !userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        req.userId = userId;
        const user = await clerkClient.users.getUser(userId);
        const metadata = user.privateMetadata || {};
        const subscriptionEndsAt = Number(metadata.razorpaySubscriptionCurrentEnd);
        // Razorpay changes `authenticated` to `active` asynchronously after
        // the verified Checkout mandate. Do not make the customer wait for
        // that webhook/state transition to use the plan.
        const hasPremiumPlan = metadata.razorpaySubscriptionStatus === 'authenticated'
            || (metadata.razorpaySubscriptionStatus === 'active'
                && Number.isFinite(subscriptionEndsAt)
                && subscriptionEndsAt > Math.floor(Date.now() / 1000));

        if (!hasPremiumPlan && user.privateMetadata.free_usage) {
            req.free_usage = user.privateMetadata.free_usage
        }

        else {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: 0
                }
            })

            req.free_usage = 0
        }
        req.plan = hasPremiumPlan ? 'premium' : "free";
        next()
    }
    catch (error) {
        res.json({ success: false, message: error.message })
    }
}
