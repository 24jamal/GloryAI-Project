import express from "express";
import {
    createMonthlySubscription,
    verifySubscriptionCheckout,
} from "../controllers/subscriptionController.js";
import { auth } from "../middelwares/auth.js";

const subscriptionRouter = express.Router();

subscriptionRouter.post("/create", auth, createMonthlySubscription);
subscriptionRouter.post("/verify", auth, verifySubscriptionCheckout);

export default subscriptionRouter;
