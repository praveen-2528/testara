import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const OPTION_COLUMNS = ['option_a', 'option_b', 'option_c', 'option_d', 'option_e'];
const REQUIRED_COLUMNS = ['question', 'option_a', 'option_b', 'correct_option'];

/**
 * Parse a CSV string into Testara question format
 */
export function parseCSVString(csvString, defaults = {}) {
    const result = Papa.parse(csvString.trim(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    if (result.errors.length > 0) {
        return { questions: [], errors: result.errors.map(e => e.message) };
    }

    return normalizeRows(result.data, defaults);
}

/**
 * Parse an XLSX/XLS file (ArrayBuffer) into Testara question format
 */
export function parseExcelBuffer(buffer, defaults = {}) {
    try {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        // Normalize headers to lowercase + underscored
        const normalized = rows.map(row => {
            const obj = {};
            for (const [key, value] of Object.entries(row)) {
                obj[key.trim().toLowerCase().replace(/\s+/g, '_')] = value;
            }
            return obj;
        });

        return normalizeRows(normalized, defaults);
    } catch (err) {
        return { questions: [], errors: [`Failed to parse Excel file: ${err.message}`] };
    }
}

/**
 * Normalize parsed rows into Testara question objects
 */
function normalizeRows(rows, defaults = {}) {
    const questions = [];
    const errors = [];

    rows.forEach((row, i) => {
        const lineNum = i + 2; // +2 for header row + 0-index

        // Check required fields
        const missingFields = REQUIRED_COLUMNS.filter(col => !row[col]?.toString().trim());
        if (missingFields.length > 0) {
            errors.push(`Row ${lineNum}: Missing required fields: ${missingFields.join(', ')}`);
            return;
        }

        // Build options array
        const options = OPTION_COLUMNS
            .map(col => row[col]?.toString().trim())
            .filter(Boolean);

        if (options.length < 2) {
            errors.push(`Row ${lineNum}: At least 2 options required`);
            return;
        }

        // Resolve correct answer
        const correctKey = row.correct_option?.toString().trim().toUpperCase();
        const correctIndex = correctKey.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3, E=4
        if (correctIndex < 0 || correctIndex >= options.length) {
            errors.push(`Row ${lineNum}: Invalid correct_option "${row.correct_option}". Expected A-${String.fromCharCode(64 + options.length)}`);
            return;
        }

        questions.push({
            text: row.question.toString().trim(),
            options,
            correctAnswer: correctIndex,
            explanation: row.explanation?.toString().trim() || '',
            subject: defaults.subject || row.subject?.toString().trim() || 'General',
            topic: defaults.topic || row.topic?.toString().trim() || '',
            subtopic: defaults.subtopic || row.subtopic?.toString().trim() || '',
            difficulty: defaults.difficulty || (row.difficulty?.toString().trim().toLowerCase()) || 'medium',
            questionType: defaults.questionType || row.question_type?.toString().trim() || 'MCQ',
            examType: defaults.examType || row.exam_type?.toString().trim() || '',
        });
    });

    return { questions, errors };
}

/**
 * Export questions array to CSV string
 */
export function questionsToCSV(questions) {
    const rows = questions.map(q => {
        const opts = q.options || [];
        const correctLetter = String.fromCharCode(65 + (q.correctAnswer || 0));
        return {
            question: q.text || q.question || '',
            option_a: opts[0] || '',
            option_b: opts[1] || '',
            option_c: opts[2] || '',
            option_d: opts[3] || '',
            option_e: opts[4] || '',
            correct_option: correctLetter,
            explanation: q.explanation || '',
            subject: q.subject || '',
            topic: q.topic || '',
            subtopic: q.subtopic || '',
            difficulty: q.difficulty || 'medium',
            question_type: q.questionType || q.question_type || 'MCQ',
            exam_type: q.examType || q.exam_type || '',
        };
    });

    return Papa.unparse(rows);
}

/**
 * Detect file type and parse accordingly
 */
export async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
        const text = await file.text();
        return parseCSVString(text, {});
    }

    if (ext === 'xlsx' || ext === 'xls') {
        const buffer = await file.arrayBuffer();
        return parseExcelBuffer(buffer, {});
    }

    if (ext === 'json') {
        const text = await file.text();
        try {
            const parsed = JSON.parse(text);
            const arr = Array.isArray(parsed) ? parsed : parsed.questions || [parsed];
            return { questions: arr, errors: [] };
        } catch (e) {
            return { questions: [], errors: [`Invalid JSON: ${e.message}`] };
        }
    }

    return { questions: [], errors: [`Unsupported file format: .${ext}. Use .csv, .xlsx, or .json`] };
}
