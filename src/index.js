const { createApp } = require("./app");

const PORT = process.env.PORT || 3000;

const server = createApp();

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
