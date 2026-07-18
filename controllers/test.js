const {db} = require("../config/firebase");

exports.testConnection = async (req, res) => {
    try{
        await db.collection("test").add({
            message: "Firebase Connected",
            createdAt: new Date(),
        });
         res.json({
            success: true,
            message: "Firestore Connected"
        });
    }catch(err){
         res.status(500).json({
            success: false,
            error: err.message
        });
    }
}