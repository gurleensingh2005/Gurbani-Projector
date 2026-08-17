import mongoose from "mongoose";

const LineSchema = new mongoose.Schema({
    id: String,
    gurmukhi: { type: String },
    transliteration: { type: String },
    transliteration_hi: String,
    translation: String,
    translation_pu: String,
    translation_hi: String,
    larivaar: String,
});

const ShabadSchema = new mongoose.Schema({
    shabadId: { type: Number, index: true, unique: true },
    bani: String,
    raag: String,
    page: Number,
    lines: [LineSchema]
}, { timestamps: true });

ShabadSchema.index({
    "lines.transliteration": "text",
    "lines.gurmukhi": "text"
}, {
    weights: {
        "lines.gurmukhi": 10,
        "lines.transliteration": 5
    },
    name: "GurbaniTextIndex"
});

ShabadSchema.index({ "lines.transliteration_hi": "text" });

export const ShabadModel = mongoose.models.Shabad || mongoose.model("Shabad", ShabadSchema);
export default ShabadModel;
