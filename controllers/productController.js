const {db, bucket} = require("../config/firebase")
const { v4: uuid} = require("uuid");
const transporter = require("../config/mailer")


exports.createProduct = async (req,res) => {
    try {

        const {productName,description,sizes,category,price} = req.body;

        if (!req.files || !req.files.mainImage) {
            return res.status(400).json({
                success: false,
                message: "Main image is required."
            });
        }

        const mainImage = req.files.mainImage[0];
        const subImages = req.files.subImages || [];

        const mainImageName = `products/${uuid()}-${mainImage.originalname}`;
        const mainImageFile = bucket.file(mainImageName);

        await mainImageFile.save(mainImage.buffer, {
            metadata: {
                contentType: mainImage.mimetype
            }
        });
        await mainImageFile.makePublic();
        const mainImageUrl = `https://storage.googleapis.com/${bucket.name}/${mainImageName}`;

        const subImageUrls = [];
        for (const image of subImages) {

            const imageName = `products/${uuid()}-${image.originalname}`;

            const imageFile = bucket.file(imageName);

            await imageFile.save(image.buffer, {
                metadata: {
                    contentType: image.mimetype
                }
            });

            await imageFile.makePublic();

            subImageUrls.push(
                `https://storage.googleapis.com/${bucket.name}/${imageName}`
            );
        }

        let arr = JSON.parse(sizes)
        const quantity = arr.reduce( (total, item) => total + item.quantity,0)

        const product = { productName,description,sizes,category,price: Number(price),quantity: Number(quantity),mainImage: mainImageUrl,subImages: subImageUrls, createdAt: new Date()};
        const docRef = await db.collection("products").add(product);

        return res.status(201).json({ success: true, message: "Product uploaded successfully.", id: docRef.id,
            product: {
                id: docRef.id,
                ...product
            }
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Failed to upload product.",
            error: error.message
        });

    }
}

exports.getProducts = async (req,res) => {
    try{

        const snapshot = await db
            .collection("products")
            .orderBy("createdAt", "desc")
            .get();

        const products = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json({
            success: true,
            count: products.length,
            products
        });

    }catch(error){
        console.error("Fetch products error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch products",
            error: error.message
        });
    }
}

exports.viewCount = async (req, res) =>{
    try{

        const {name, view} = req.body;
        console.log(req.body)
        //console.log(req)
        console.log(name)
        //let object = JSON.parse(obj)

        //const view = { name: object.name, type: obj.view, viewedAt: serverTimestamp()}
        //const docRef = await db.collection("views").add(view);

    }catch(error){
        console.error("Get product error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch product.",
            error: error.message
        });
    }
}



exports.getProductById = async (req,res) =>{
    try{
         const { id } = req.params;
         if (!id) {
            return res.status(400).json({
                success: false,
                message: "Product ID is required."
            });
        }
        const productRef = db.collection("products").doc(id);
        const productSnapshot = await productRef.get();

         if (!productSnapshot.exists) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        const product = {
            id: productSnapshot.id,
            ...productSnapshot.data()
        };

        return res.status(200).json({
            success: true,
            product
        });

    }catch(error){
        console.error("Get product error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch product.",
            error: error.message
        });
    }
}

exports.checkout = async (req, res) =>{
    try{
        const {
            customerPhone,
            cart,
            total,
            subtotal,
            discount
        } = req.body;

        if (!cart || cart.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Cart is empty"
            });
        }

         await db.runTransaction(async (transaction) =>{
            const productsToUpdate = [];

            for (const item of cart) {

                const productRef = db.collection("products").doc(item.id);
                const productDoc = await transaction.get(productRef);

                if (!productDoc.exists) {
                    throw new Error(`${item.productName} not found`);
                }

                const product = productDoc.data();

                productsToUpdate.push({
                    item,
                    productRef,
                    product
                });
            }

            for (const { item, productRef, product } of productsToUpdate) {

                let sizes = JSON.parse(product.sizes);

                const sizeIndex = sizes.findIndex(
                    s => s.size === item.size
                );

                if (sizeIndex === -1) {
                    throw new Error(
                        `Size ${item.size} not found for ${product.productName}`
                    );
                }

                if (sizes[sizeIndex].quantity < item.quantity) {
                    throw new Error(
                        `Only ${sizes[sizeIndex].quantity} left for ${product.productName} size ${item.size}`
                    );
                }

                // Reduce stock
                sizes[sizeIndex].quantity -= item.quantity;

                // Recalculate total quantity
                const totalQuantity = sizes.reduce(
                    (sum, s) => sum + s.quantity,
                    0
                );

                transaction.update(productRef, {
                    sizes: JSON.stringify(sizes),
                    quantity: totalQuantity
                });
            }

            const saleRef = db.collection("sales").doc();
            transaction.set(saleRef, {
                customerPhone,
                cart,
                total,
                subtotal,
                discount,
                createdAt: new Date()
            });

         });

        let emailBody = `
                    New Sale

                    Customer: ${customerPhone}

                    Items
                    -----------------------------------------------
                    `;
                            cart.forEach(item => {
                                emailBody += `
                    Product: ${item.productName}
                    Size: ${item.size}
                    Quantity: ${item.quantity}
                    Price: ZMW ${item.price}

                    `;
                });

        emailBody += `
                -----------------------------------------------
                Total: ZMW ${total}
                `;

                        await transporter.sendMail({
                            from: process.env.EMAIL_USER,
                            to: process.env.EMAIL_TO,
                            subject: "New Lumina Sale",
                            text: emailBody
                        });

                        return res.status(201).json({
                            success: true,
                            message: "Sale recorded successfully"
                        });

    }catch(error){
        console.error("checkout error:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
            error: error.message
        });
    }
}


