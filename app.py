import os
import sqlite3
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app)

DATABASE = os.getenv("DATABASE", "./db/questions.db")
VALID_DIFFICULTIES = os.getenv("VALID_DIFFICULTIES", "easy,medium,hard").split(',')
DEFAULT_DIFFICULTY = os.getenv("DEFAULT_DIFFICULTY", "easy")
DEFAULT_LIMIT = int(os.getenv("DEFAULT_LIMIT", 15))
MAX_LIMIT = int(os.getenv("MAX_LIMIT", 50))

MEAN_RAW_SCORE = {'Easy': 20, 'Medium': 50, 'Hard': 70}
STD_DEV_RAW_SCORE = {'Easy': 5, 'Medium': 10, 'Hard': 15}

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def validate_params(difficulty, limit):
    if difficulty not in VALID_DIFFICULTIES:
        return False, f"Invalid difficulty level. Choose from {VALID_DIFFICULTIES}"
    
    if not (1 <= limit <= MAX_LIMIT):
        return False, f"Limit must be between 1 and {MAX_LIMIT}"
    
    return True, ""

def get_random_questions(difficulty, limit):
    conn = get_db_connection()
    query = """
        SELECT 
            q.QuestionID, q.QuestionText, o.OptionText
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
        ORDER BY q.QuestionID, o.OptionID;
    """
    
    cursor = conn.execute(query, (difficulty, difficulty, limit))
    rows = cursor.fetchall()
    conn.close()

    questions_map = {}
    for row in rows:
        question_id = row["QuestionID"]
        if question_id not in questions_map:
            questions_map[question_id] = {
                "question_id": question_id,
                "question": row["QuestionText"],
                "options": []
            }
        questions_map[question_id]["options"].append(row["OptionText"])

    return list(questions_map.values())

def calculate_iq(mode, score):
    mean_raw_score = MEAN_RAW_SCORE[mode.capitalize()]
    std_dev_raw_score = STD_DEV_RAW_SCORE[mode.capitalize()]

    iq = 100 + ((score - mean_raw_score) / std_dev_raw_score) * 15

    percentile = str(min(max(int((iq / 200) * 100), 1), 99)) + 'th'
    return round(iq), percentile

@app.route("/random-questions", methods=["GET"])
def random_questions():
    difficulty = request.args.get("difficulty", DEFAULT_DIFFICULTY)
    limit = int(request.args.get("limit", DEFAULT_LIMIT))

    is_valid, message = validate_params(difficulty, limit)
    if not is_valid:
        return jsonify({"error": message}), 400

    try:
        questions = get_random_questions(difficulty, limit)
        if not questions:
            return jsonify({"message": "No questions found for the specified criteria."}), 404
        return jsonify(questions), 200
    except Exception as e:
        print(f"Error retrieving questions: {e}")
        return jsonify({"error": "Failed to retrieve questions."}), 500

@app.route("/validate-answers", methods=["POST"])
def validate_answers():
    user_answers = request.json 
    difficulty = request.args.get("difficulty", DEFAULT_DIFFICULTY).capitalize()  

    question_ids = [answer["questionId"] for answer in user_answers]
    placeholders = ','.join('?' * len(question_ids))

    query = f"""
        SELECT q.QuestionID, o.OptionText as correctAnswerText
        FROM Question q
        JOIN Answer a ON q.QuestionID = a.QuestionID
        JOIN Option o ON o.OptionID = a.OptionID
        WHERE q.QuestionID IN ({placeholders})
    """

    conn = get_db_connection()
    correct_answers = conn.execute(query, question_ids).fetchall()
    conn.close()

    score = 0
    results = []
    for user_answer in user_answers:
        correct_answer = next(
            (row for row in correct_answers if row["QuestionID"] == user_answer["questionId"]), None
        )
        is_correct = correct_answer and correct_answer["correctAnswerText"] == user_answer["answer"]
        if is_correct:
            score += 1
        results.append({
            "questionId": user_answer["questionId"],
            "userAnswer": user_answer["answer"],
            "correctAnswer": correct_answer["correctAnswerText"] if correct_answer else None,
            "isCorrect": is_correct
        })

    iq, percentile = calculate_iq(difficulty, score)

    return jsonify({
        "score": score,
        "iq": iq,
        "percentile": percentile,
        "results": results
    })

@app.route('/')
def index():
    return render_template('IQ5.html')

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)),debug=True)