const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const site_domain = process.env.SITE_DOMAIN || "http://localhost:5173";

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.aopfsxd.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const decoded = Buffer.from(
  process.env.FIREBASE_ADMIN_TOKEN,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  // console.log(req.headers);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    // await client.connect();

    const db = client.db("fabrico");
    const userCollection = db.collection("users");
    const productCollection = db.collection("products");
    const orderCollection = db.collection("orders");
    const paymentCollection = db.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      console.log(user);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.status = "pending";
      const email = user.email;
      user.createdAt = new Date();
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "User already exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const { email } = req.query;
      const query = {};

      if (email) {
        query.email = email;
        const result = await userCollection.findOne(query);
        return res.send(result);
      }

      const result = await userCollection.find(query).toArray();
      return res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user.role });
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleStatus = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: roleStatus.status,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.post("/products", verifyFBToken, async (req, res) => {
      const product = req.body;
      const email = req.decoded_email;

      const user = await userCollection.findOne({ email: email });
      if (user.role !== "manager") {
        return res.status(401).send("Unauthorized access");
      }

      product.createdBy = email;
      product.createdAt = new Date();
      const result = await productCollection.insertOne(product);
      res.send(result);
    });

    app.get("/orders", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;

      const user = await userCollection.findOne({ email: email });
      if (user.role !== "admin") {
        return res.status(401).send("Unauthorized access");
      }

      const result = await orderCollection.find({}).toArray();
      res.send(result);
    });

    app.get("/products", async (req, res) => {
      const productLimit = parseInt(req.query.limit);
      if (productLimit) {
        const products = await productCollection
          .find({})
          .limit(productLimit)
          .toArray();
        res.send(products);
      } else {
        const products = await productCollection.find({}).toArray();
        res.send(products);
      }
    });

    app.get("/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = {};
      if (id) {
        query._id = new ObjectId(id);
      }
      const product = await productCollection.findOne(query);
      res.send(product);
    });

    app.post("/orders", async (req, res) => {
      const orderPayload = req.body;
      orderPayload.createdAt = new Date();
      orderPayload.paymentStatus = "pending";

      const result = await orderCollection.insertOne(orderPayload);
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      try {
        const productPayload = req.body;

        // Validate required fields
        if (
          !productPayload.totalPrice ||
          !productPayload.productName ||
          !productPayload.email
        ) {
          return res.status(400).send({
            error: "Missing required fields: totalPrice, productName, or email",
          });
        }

        const amount = Math.round(productPayload.totalPrice * 100); // Convert to cents

        // console.log("Creating checkout session for amount:", amount);

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: productPayload.productName,
                  description: `Quantity: ${productPayload.quantity || 1}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            productId: productPayload.productId,
            orderId: productPayload.orderId || "",
            quantity: productPayload.quantity?.toString() || "1",
          },
          customer_email: productPayload.email,
          success_url: `${site_domain}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${site_domain}/dashboard/payment-cancelled`,
        });

        // Return the URL to the client instead of redirecting
        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe session creation error:", error);
        res.status(500).send({
          error: "Failed to create checkout session",
          details: error.message,
        });
      }
    });

    // Get payment success details
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
          return res.status(400).send({ error: "Session ID required" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;

        if (session.payment_status === "paid") {
          const productId = session.metadata.productId;

          // Update order status
          await orderCollection.updateOne(
            { productId: productId, email: session.customer_email },
            {
              $set: {
                paymentStatus: "paid",
                transactionId: transactionId,
                paidAt: new Date(),
              },
            }
          );

          // Check if payment already exists
          const paymentExists = await paymentCollection.findOne({
            transactionId,
          });

          if (!paymentExists) {
            const payment = {
              amount: session.amount_total / 100,
              currency: session.currency,
              customerEmail: session.customer_email,
              productId: productId,
              transactionId: transactionId,
              paymentStatus: session.payment_status,
              paidAt: new Date(),
            };

            await paymentCollection.insertOne(payment);
          }
        }

        res.send({
          success: true,
          paymentStatus: session.payment_status,
          transactionId: transactionId,
          amount: session.amount_total / 100,
        });
      } catch (error) {
        console.error("Payment verification error:", error);
        res.status(500).send({
          error: "Failed to verify payment",
          details: error.message,
        });
      }
    });

    console.log("Successfully connected to mongoDB");
  } finally {
    //
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Invalid or unknown route");
});

app.listen(port, () => {
  console.log(`Server is running on port: `, port);
});
