const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@cluster0.h0zb1dz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("hostelmaniaDB").collection("users");
    const menuCollection = client.db("hostelmaniaDB").collection("menu");
    const reviewCollection = client.db("hostelmaniaDB").collection("review");
    const requestCollection = client
      .db("hostelmaniaDB")
      .collection("mealrequests");
    const upcomingCollection = client
      .db("hostelmaniaDB")
      .collection("upcomingMeals");
    const paymentCollection = client.db("hostelmaniaDB").collection("payments");

    // menuCollection.createIndex({ foodname: 'text' })
    // .then(() => console.log('Index created on name field'))
    // .catch(err => console.error('Failed to create index:', err));

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //User related apis
    app.get("/users", verifyToken, async (req, res) => {
      const search = req.query.search || "";
      let query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    // app.get("/user/:search", verifyToken, async (req, res) => {
    //   const search = req.params.search;
    //   let query = {
    //     name: { $regex: search, $options: 'i' },
    //   }
    //   const result = await userCollection.find(query).toArray();
    //   res.send(result);
    // });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    //menu related apis
    app.get("/menu", async (req, res) => {
      const filter = req.query.filter || "";
      const search = req.query.search || "";

      let query = {
        // foodname: { $regex: search, $options: "i" },
      };

      query.$or = [
        { foodname: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { ingredients: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];

      if (filter) query.category = filter;

      const minPrice = parseFloat(req.query.minPrice) || 0;
      const maxPrice = parseFloat(req.query.maxPrice);
      if (!isNaN(minPrice) || !isNaN(maxPrice)) {
        query.price = {};
        if (!isNaN(minPrice)) {
          query.price.$gte = minPrice;
        }
        if (!isNaN(maxPrice)) {
          query.price.$lte = maxPrice;
        }
      }

      const result = await menuCollection
        .find(query)
        .sort({ like: -1, reviews: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.get("/fooditem/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await menuCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    app.patch("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          name: item.name,
          email: item.email,
          foodname: item.foodname,
          category: item.category,
          price: item.price,
          image: item.image,
          ingredients: item.ingredients,
          description: item.description,
          time: item.time,
          like: item.like,
          reviews: item.reviews,
        },
      };
      const result = await menuCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/like/:id", async (req, res) => {
      const id = req.params.id;
      const updateDoc = {
        $inc: { like: 1 },
      };
      const query = { _id: new ObjectId(id) };
      const likeUpdate = await menuCollection.updateOne(query, updateDoc);
      res.send(likeUpdate);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    //review related apis
    app.get("/reviews", verifyToken, verifyAdmin, async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.get("/myreviews/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/review", async (req, res) => {
      const item = req.body;
      const result = await reviewCollection.insertOne(item);
      const updateDoc = {
        $inc: { reviews: 1 },
      };
      const query = { _id: new ObjectId(item.id) };
      const updateReviewCount = await menuCollection.updateOne(
        query,
        updateDoc
      );
      res.send(result);
    });

    app.patch("/myreviews/:id", async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          review: data.review,
        },
      };
      const result = await reviewCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/review/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reviewCollection.deleteOne(query);
      res.send(result);
    });

    app.delete("/myreviews/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reviewCollection.deleteOne(query);
      res.send(result);
    });

    //Meal Request related APIs
    app.get("/mealrequest", async (req, res) => {
      const search = req.query.search || "";
      let query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/requests", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await requestCollection.find(query).toArray();
      console.log(query);
      res.send(result);
    });

    app.post("/mealrequest", async (req, res) => {
      const item = req.body;
      const result = await requestCollection.insertOne(item);
      res.send(result);
    });

    app.patch(
      "/mealrequest/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "delivered",
          },
        };
        const result = await requestCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/requests/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestCollection.deleteOne(query);
      res.send(result);
    });

    //Upcoming Meals APIs
    app.get("/upcomingMeals", async (req, res) => {
      const result = await upcomingCollection
        .find()
        .sort({ like: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/upcomingMeals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await upcomingCollection.findOne(query);
      res.send(result);
    });

    app.post("/upcomingMeals", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await upcomingCollection.insertOne(item);
      res.send(result);
    });

    app.patch("/upcomingLike/:id", async (req, res) => {
      const id = req.params.id;
      const updateDoc = {
        $inc: { like: 1 },
      };
      const query = { _id: new ObjectId(id) };
      const likeUpdate = await upcomingCollection.updateOne(query, updateDoc);
      res.send(likeUpdate);
    });

    app.delete(
      "/upcomingMeals/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await upcomingCollection.deleteOne(query);
        res.send(result);
      }
    );

    //PAYMENT APIs
    //Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      const id = payment.userId;
      const badge = payment.packageName;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          badge: badge,
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send({ paymentResult, result });
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hostel Mania Server is Working...");
});

app.listen(port, () => {
  console.log("HostelMania is working on port", port);
});
