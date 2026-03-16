const mongoose = require('mongoose');
const livroSchema = new mongoose.Schema({
    _id: { type: String, required: true }, 
    titulo: String,
    autor: String,
    ditadoPor: String,
    categoria: String, 
    preco_custo: Number,
    preco_venda: Number,
    estoque_atual: Number,
    estoque_minimo: Number // Para avisar quando o livro estiver acabando
}, { collection: 'livros' }); 

module.exports = mongoose.model('Livro', livroSchema);