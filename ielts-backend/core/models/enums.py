from enum import StrEnum


class Skill(StrEnum):
    READING = "reading"
    LISTENING = "listening"
    WRITING = "writing"
    SPEAKING = "speaking"


class Module(StrEnum):
    """Which Reading test a version is: it picks the raw-mark band table."""

    ACADEMIC = "academic"
    GENERAL_TRAINING = "general_training"


class VersionStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    RETIRED = "retired"


class SessionMode(StrEnum):
    PRACTICE = "practice"
    EXAM = "exam"


class SessionStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"


class SubmitReason(StrEnum):
    STUDENT = "student"
    TIMEOUT = "timeout"


class GradingMethod(StrEnum):
    AUTO = "auto"
    AI = "ai"
    HUMAN = "human"


class AssessmentStatus(StrEnum):
    """An AI grading job: `held` is graded but flagged as a likely manipulation attempt."""

    PROCESSING = "processing"
    READY = "ready"
    HELD = "held"
    FAILED = "failed"


class HumanGradeStatus(StrEnum):
    """A teacher-graded session's place in the queue."""

    AWAITING_GRADER = "awaiting_grader"
    CLAIMED = "claimed"
    GRADED = "graded"


class HumanGradeOrigin(StrEnum):
    """Why a session is graded by a teacher."""

    SPEAKING = "speaking"
    STUDENT_REQUEST = "student_request"
    AI_FALLBACK = "ai_fallback"
    AI_FLAGGED = "ai_flagged"


class Criterion(StrEnum):
    """IELTS Writing criteria; Task 1 is judged on Task Achievement, Task 2 on Task Response."""

    TASK_ACHIEVEMENT = "task_achievement"
    TASK_RESPONSE = "task_response"
    COHERENCE_COHESION = "coherence_cohesion"
    LEXICAL_RESOURCE = "lexical_resource"
    GRAMMATICAL_RANGE_ACCURACY = "grammatical_range_accuracy"


class CommentKind(StrEnum):
    """Whether a Writing feedback comment praises something or points to a way to improve."""

    STRENGTH = "strength"
    IMPROVEMENT = "improvement"


class SignalSource(StrEnum):
    """Why an essay was flagged as a likely attempt to manipulate its grade."""

    PATTERN = "pattern"
    HIDDEN_TEXT = "hidden_text"
    MARKER = "marker"
    MODEL = "model"
    IMPLAUSIBLE_BAND = "implausible_band"


def check_in(column: str, enum: type[StrEnum]) -> str:
    """SQL for a check constraint limiting `column` to the enum's values."""
    values = ", ".join(f"'{member.value}'" for member in enum)
    return f"{column} IN ({values})"
