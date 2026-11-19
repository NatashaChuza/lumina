const express = require('express');
const router = express.Router();
const controller = require("../controllers/test")
const upload = require('../middleware/upload')
const productController = require('../controllers/productController')
const orderController = require('../controllers/orderController')

router.get('/', (req, res) => {
    res.json({ message: 'User route works!' });
});

router.get("/test", controller.testConnection);

router.post(
    "/products",
    upload.fields([
        {name: "mainImage", maxCount: 1},
        {name: 'subImages', maxCount: 6}
    ]),
    productController.createProduct
)

router.get(
    '/products',
    productController.getProducts
)

router.get(
    "/products/:id",
    productController.getProductById
);

// Checkout: price check, then order after payment (verified with Lenco).
router.post("/checkout/quote", orderController.quote)
router.post("/orders", orderController.createOrder)

// The old /sales endpoint recorded sales without checking payment. It now
// goes through the same verified order flow.
router.post("/sales", orderController.createOrder)

router.post(
    "/views",
    productController.viewCount
)

router.get(
    "/getViews", 
    productController.getViews
)

module.exports = router;