import express from 'express';
import * as dotenv from 'dotenv';
import { authRouter } from './routes/auth';

dotenv.config();

//verify env variables

console.log("PORT=", process.env.PORT);
console.log("REDIRECT=", process.env.PINTEREST_REDIRECT_URI);

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Pinterest Agent Running');
});

app.use('/pinterest', authRouter);

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});