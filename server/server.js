import express from "express";
import cors from "cors";
import 'dotenv/config';
import { clerkMiddleware } from "@clerk/express"
import aiRouter from "./routes/aiRoutes.js";
import connectCloudinary from "./configs/cloudinary.js";
import userRouter from "./routes/userRoutes.js";
import subscriptionRouter from "./routes/subscriptionRoutes.js";
import { handleRazorpayWebhook } from "./controllers/subscriptionController.js";
import rateLimit from "express-rate-limit";


const app = express();
await connectCloudinary()

const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(cors());
app.use("/api/ai", aiLimiter);
// Razorpay signs the exact request bytes. This must be registered before
// express.json() and before Clerk's authenticated routes.
app.post("/api/razorpay/webhook", express.raw({ type: "application/json" }), handleRazorpayWebhook);

app.use(express.json());
app.use(clerkMiddleware());

app.get("/", (req, res) => {
    res.send("Server is live")
})

app.use('/api/ai', aiRouter)
app.use('/api/user', userRouter)
app.use('/api/subscriptions', subscriptionRouter)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server is running on PORT ${PORT}`);
})
