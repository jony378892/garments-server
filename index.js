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
    await client.connect();

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
