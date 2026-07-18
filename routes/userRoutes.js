const express = require('express');
const router = express.Router();
const controller = require("../controllers/test")
const upload = require('../middleware/upload')
const productController = require('../controllers/productController')

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

router.post(
    "/sales",
    productController.checkout
)

module.exports = router;