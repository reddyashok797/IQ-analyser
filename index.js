const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
const Joi = require("joi");
const morgan = require("morgan");
const helmet = require("helmet");
const path = require("path");

// Load environment variables from .env file
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(morgan("combined"));
app.use(helmet());

// Configuration
const PORT = process.env.PORT || 3000;
const DATABASE = process.env.DATABASE || "./db/questions.db";
const VALID_DIFFICULTIES = process.env.VALID_DIFFICULTIES.split(","); // ['easy', 'medium', 'hard']
const DEFAULT_DIFFICULTY = process.env.DEFAULT_DIFFICULTY || "easy";
const DEFAULT_LIMIT = parseInt(process.env.DEFAULT_LIMIT, 10) || 15;
const MAX_LIMIT = parseInt(process.env.MAX_LIMIT, 10) || 50;

// Initialize SQLite Database
let db = new sqlite3.Database(DATABASE, (err) => {
  if (err) {
    console.error(`Failed to connect to the database. ${err.message}`);
    process.exit(1); // Exit the application if the database connection fails
  }
  console.log("Connected to the SQLite database.");
});

// Schema Validation using Joi
const querySchema = Joi.object({
  difficulty: Joi.string()
    .valid(...VALID_DIFFICULTIES)
    .default(DEFAULT_DIFFICULTY),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * Function to fetch random questions based on difficulty and limit
 * @param {string} difficulty - Difficulty level ('easy', 'medium', 'hard')
 * @param {number} limit - Number of questions to retrieve
 * @returns {Promise<Array>} - Resolves to an array of questions
 */
const getRandomQuestions = (difficulty, limit) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
          q.QuestionID,
          q.QuestionText,
          o.OptionText
      FROM 
          Question q
      JOIN 
          Option o ON q.QuestionID = o.QuestionID
      WHERE 
          q.Difficulty = ?
      AND 
          q.QuestionID IN (
              SELECT QuestionID 
              FROM Question 
              WHERE Difficulty = ?
              ORDER BY RANDOM() 
              LIMIT ?
          )
      ORDER BY 
          q.QuestionID, o.OptionID;
    `;

    db.all(query, [difficulty, difficulty, limit], (err, rows) => {
      if (err) {
        return reject(err);
      }

      const questionsMap = {};

      rows.forEach((row) => {
        const questionId = row.QuestionID;

        if (!questionsMap[questionId]) {
          questionsMap[questionId] = {
            question_id: questionId,
            question: row.QuestionText,
            options: [],
          };
        }

        questionsMap[questionId].options.push(row.OptionText);
      });

      const questionsList = Object.values(questionsMap);
      resolve(questionsList);
    });
  });
};

/**
 * GET /random-questions
 * Query Parameters:
 * - difficulty: 'easy', 'medium', 'hard' (default: 'easy')
 * - limit: integer between 1 and MAX_LIMIT (default: 15)
 */
app.get("/random-questions", async (req, res) => {
  // Validate query parameters
  const { error, value } = querySchema.validate(req.query);

  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { difficulty, limit } = value;

  try {
    const questions = await getRandomQuestions(difficulty, limit);

    if (questions.length === 0) {
      return res
        .status(404)
        .json({ message: "No questions found for the specified criteria." });
    }

    return res.status(200).json(questions);
  } catch (err) {
    console.error(`Error retrieving questions: ${err.message}`);
    return res.status(500).json({ error: "Failed to retrieve questions." });
  }
});

/**
 * Root Route
 */
app.get("/", (req, res) => {
  res.status(200).json({
    message:
      "Welcome to the Questions API. Use /random-questions to retrieve questions.",
  });
});

// POST route to validate answers
app.post("/validate-answers", (req, res) => {
  const userAnswers = req.body; // [{ questionId: 1, answer: 'user_selected_answer' }, ...]

  const questionIds = userAnswers.map((answer) => answer.questionId);
  const placeholders = questionIds.map(() => "?").join(",");
  console.log(placeholders);
  // Query to fetch the correct answer text for the provided question IDs
  const sql = `SELECT q.QuestionID, o.OptionText as correctAnswerText
               FROM Question q
               JOIN Answer a ON q.QuestionID = a.QuestionID
               JOIN Option o ON o.OptionID = a.OptionID
               WHERE q.QuestionID IN (${placeholders})`;

  db.all(sql, questionIds, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Validate the user's answers
    let score = 0;
    const results = userAnswers.map((userAnswer) => {
      const correctAnswer = rows.find(
        (row) => row.QuestionID === userAnswer.questionId
      );
      const isCorrect =
        correctAnswer && correctAnswer.correctAnswerText === userAnswer.answer;

      if (isCorrect) score += 1;

      return {
        questionId: userAnswer.questionId,
        userAnswer: userAnswer.answer,
        correctAnswer: correctAnswer ? correctAnswer.correctAnswerText : null,
        isCorrect,
      };
    });

    // Send the results and score back to the user
    res.json({ score, results });
  });
});
/**
 * 404 Handler
 */
app.use((req, res, next) => {
  res.status(404).json({ error: "Route not found." });
});

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

/**
 * Start the Server
 */
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

/**
 * Gracefully Close the Database Connection on Exit
 */
process.on("SIGINT", () => {
  console.log("\nClosing the database connection.");
  db.close((err) => {
    if (err) {
      console.error(`Error closing the database: ${err.message}`);
      process.exit(1);
    }
    console.log("Database connection closed.");
    process.exit(0);
  });
});
