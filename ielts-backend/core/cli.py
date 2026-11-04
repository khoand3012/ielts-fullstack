"""Admin command line.

- ``python -m core.cli set-role <email> <role>``
- ``python -m core.cli load-test <file.json> [--publish]``
- ``python -m core.cli regrade-auto [--all]``
- ``python -m core.cli regrade-ai`` (retry failed AI grading)
- ``python -m core.cli held-ai list | show <id> | release <id> --by <admin-email>``
"""

import argparse
import asyncio
import sys
import uuid
from collections.abc import Sequence
from pathlib import Path

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.ai.client import OpenRouterClient
from core.db import async_session_factory
from core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from core.models import Role
from core.services import ai_review
from core.services.ai_grading import GradingRunner, regrade_failed
from core.services.sessions import rescore_sessions
from core.services.test_loader import load_test_file
from core.services.users import set_role_by_email

# Same normalization registration applies (EmailStr lowercases the domain), so the email
# can be typed exactly as the user registered it.
_email = TypeAdapter(EmailStr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m core.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    set_role = commands.add_parser("set-role", help="set a user's role")
    set_role.add_argument("email")
    set_role.add_argument("role", choices=[r.value for r in Role])
    load_test = commands.add_parser("load-test", help="load a test from a JSON file as a draft")
    load_test.add_argument("path", type=Path)
    load_test.add_argument("--publish", action="store_true", help="publish it if it has no errors")
    regrade = commands.add_parser(
        "regrade-auto", help="score Reading/Listening sessions that have no score"
    )
    regrade.add_argument(
        "--all", action="store_true", help="re-score every session, overwriting stored scores"
    )
    commands.add_parser("regrade-ai", help="retry AI grading of every failed Writing session")
    held = commands.add_parser("held-ai", help="review AI grades held for suspected manipulation")
    held_commands = held.add_subparsers(dest="held_command", required=True)
    held_commands.add_parser("list", help="every held essay, oldest first")
    show = held_commands.add_parser("show", help="a held essay with its signals and essays")
    show.add_argument("assessment_id", type=uuid.UUID)
    release = held_commands.add_parser("release", help="a false alarm: the AI grade stands")
    release.add_argument("assessment_id", type=uuid.UUID)
    release.add_argument("--by", required=True, help="the releasing admin's email")
    return parser


async def run(
    argv: Sequence[str],
    session_factory: async_sessionmaker[AsyncSession] = async_session_factory,
) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "load-test":
        return await _load_test(args.path, args.publish, session_factory)
    if args.command == "regrade-auto":
        return await _regrade_auto(args.all, session_factory)
    if args.command == "regrade-ai":
        return await _regrade_ai(session_factory)
    if args.command == "held-ai":
        return await _held_ai(args, session_factory)
    return await _set_role(args.email, args.role, session_factory)


async def _set_role(
    raw_email: str, role: str, session_factory: async_sessionmaker[AsyncSession]
) -> int:
    try:
        email = _email.validate_python(raw_email)
    except ValidationError:
        print(f"invalid email address {raw_email}", file=sys.stderr)
        return 1
    async with session_factory() as session:
        try:
            await set_role_by_email(session, email, Role(role))
        except NotFoundError:
            print(f"no user with email {raw_email}", file=sys.stderr)
            return 1
    print(f"set role of {raw_email} to {role}")
    return 0


async def _load_test(
    path: Path, publish: bool, session_factory: async_sessionmaker[AsyncSession]
) -> int:
    async with session_factory() as session:
        try:
            result = await load_test_file(session, path, publish=publish)
        except ValidationAppError as exc:
            print(exc.message, file=sys.stderr)
            return 1
    print(f"loaded {result.slug} v{result.version.version} ({result.version.status})")
    for p in result.problems:
        print(f"{p.severity} {p.code} section={p.section} question={p.question}: {p.message}")
    return 1 if publish and not result.published else 0


async def _regrade_auto(everything: bool, session_factory: async_sessionmaker[AsyncSession]) -> int:
    counts = await rescore_sessions(session_factory, everything=everything)
    print(f"scored {counts.scored} sessions")
    if counts.failed:
        print(f"failed to score {counts.failed} sessions (see log)", file=sys.stderr)
        return 1
    return 0


async def _regrade_ai(session_factory: async_sessionmaker[AsyncSession]) -> int:
    client = OpenRouterClient.from_settings()
    try:
        counts = await regrade_failed(GradingRunner(session_factory, client))
    finally:
        await client.aclose()
    print(f"graded {counts.ready} ready, {counts.held} held")
    if counts.failed:
        print(f"failed to grade {counts.failed} sessions (see log)", file=sys.stderr)
        return 1
    return 0


def _print_held(item: ai_review.HeldItem) -> None:
    sources = ",".join(sorted({s["source"] for s in item.signals}))
    print(
        f"{item.assessment_id} {item.email} submitted {item.submitted_at.isoformat()} "
        f"band {item.band} (task 1 {item.task1_band}, task 2 {item.task2_band}) "
        f"signals {sources}"
    )


async def _held_ai(
    args: argparse.Namespace, session_factory: async_sessionmaker[AsyncSession]
) -> int:
    async with session_factory() as session:
        try:
            if args.held_command == "list":
                items = await ai_review.list_held(session)
                for item in items:
                    _print_held(item)
                if not items:
                    print("no held essays")
            elif args.held_command == "show":
                item, essays = await ai_review.get_held(session, args.assessment_id)
                _print_held(item)
                print(f"session {item.session_id}")
                for signal in item.signals:
                    print(f"- {signal['source']} (task {signal['task']}): {signal['detail']}")
                for task, essay in essays.items():
                    print(f"\n--- Task {task} ---\n{essay}")
            else:
                await ai_review.release_held(session, args.assessment_id, args.by)
                print(f"released {args.assessment_id}")
        except (NotFoundError, ForbiddenError) as exc:
            print(exc.message, file=sys.stderr)
            return 1
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(run(sys.argv[1:])))


if __name__ == "__main__":
    main()
