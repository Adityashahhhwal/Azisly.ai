import { createAptiQuizServer } from "./server.js";

const app = createAptiQuizServer();
app.listen().then(() => {
  const address = app.httpServer.address();
  const port = typeof address === "object" && address ? address.port : process.env.PORT ?? 3001;
  console.log(`AptiQuiz server listening on ${port}`);
});