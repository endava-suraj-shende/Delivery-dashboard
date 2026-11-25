"""Transactional e-mail via Resend (https://resend.com/docs/api-reference/emails/send-email).

Without an API key the message is written to the log so local development still works.
"""
from __future__ import annotations

import html
from typing import Any, Dict, Optional

import httpx

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("email")

RESEND_URL = "https://api.resend.com/emails"


def _layout(title: str, intro: str, button_text: Optional[str], button_url: Optional[str], footer: str) -> str:
    btn = ""
    if button_text and button_url:
        btn = (f'<p style="margin:28px 0"><a href="{html.escape(button_url)}" '
               f'style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;'
               f'font-weight:600;display:inline-block">{html.escape(button_text)}</a></p>'
               f'<p style="font-size:12px;color:#64748b">If the button does not work, copy this link:<br>'
               f'<span style="word-break:break-all">{html.escape(button_url)}</span></p>')
    return f"""<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<div style="background:linear-gradient(135deg,#1d4ed8,#06b6d4);padding:22px 28px;color:#fff">
<p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85">Employee Delivery Dashboard</p>
<h1 style="margin:6px 0 0;font-size:20px">{html.escape(title)}</h1></div>
<div style="padding:28px;font-size:15px;line-height:1.6">{intro}{btn}
<p style="font-size:12px;color:#64748b;margin-top:32px">{html.escape(footer)}</p></div></div></body></html>"""


class EmailService:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    @property
    def enabled(self) -> bool:
        return bool(self.s.resend_api_key)

    def send(self, to: str, subject: str, html_body: str, text_body: str) -> Dict[str, Any]:
        if not self.enabled:
            log.warning("E-mail not configured (EDD_RESEND_API_KEY); message to %s not sent.\n%s", to, text_body)
            return {"sent": False, "reason": "email_not_configured"}
        payload = {"from": self.s.email_from, "to": [to], "subject": subject, "html": html_body, "text": text_body}
        try:
            r = httpx.post(RESEND_URL, json=payload, timeout=20,
                           headers={"Authorization": f"Bearer {self.s.resend_api_key}", "Content-Type": "application/json"})
            if r.status_code >= 400:
                log.error("Resend rejected message to %s: %s %s", to, r.status_code, r.text[:300])
                return {"sent": False, "reason": f"resend_{r.status_code}", "detail": r.text[:300]}
            return {"sent": True, "id": r.json().get("id")}
        except httpx.HTTPError as exc:
            log.error("Resend request failed: %s", exc)
            return {"sent": False, "reason": "network_error"}

    # ------------------------------------------------------------------ templates
    def send_verification(self, to: str, name: str, link: str) -> Dict[str, Any]:
        intro = (f"<p>Hi {html.escape(name)},</p><p>Confirm your e-mail address to finish creating your account. "
                 f"The link is valid for {self.s.verify_token_hours} hours.</p>")
        text = f"Hi {name},\n\nConfirm your e-mail address to finish creating your account:\n{link}\n\nThe link is valid for {self.s.verify_token_hours} hours."
        return self.send(to, "Verify your e-mail address", _layout("Verify your e-mail", intro, "Verify e-mail", link,
                         "If you did not create an account, you can ignore this message."), text)

    def send_reset(self, to: str, name: str, link: str) -> Dict[str, Any]:
        intro = (f"<p>Hi {html.escape(name)},</p><p>We received a request to reset your password. "
                 f"The link is valid for {self.s.reset_token_minutes} minutes.</p>")
        text = f"Hi {name},\n\nReset your password using this link (valid {self.s.reset_token_minutes} minutes):\n{link}"
        return self.send(to, "Reset your password", _layout("Reset your password", intro, "Choose a new password", link,
                         "If you did not request a reset, no action is needed; your password has not changed."), text)

    def send_approved(self, to: str, name: str, role_label: str, link: str) -> Dict[str, Any]:
        intro = f"<p>Hi {html.escape(name)},</p><p>Your access request was approved with the role <b>{html.escape(role_label)}</b>. You can sign in now.</p>"
        text = f"Hi {name},\n\nYour access request was approved with the role {role_label}. Sign in: {link}"
        return self.send(to, "Your access has been approved", _layout("Access approved", intro, "Open the dashboard", link, "Welcome aboard."), text)

    def send_rejected(self, to: str, name: str, reason: Optional[str]) -> Dict[str, Any]:
        why = f"<p>Reason: {html.escape(reason)}</p>" if reason else ""
        intro = f"<p>Hi {html.escape(name)},</p><p>Your access request was not approved.</p>{why}"
        text = f"Hi {name},\n\nYour access request was not approved." + (f"\nReason: {reason}" if reason else "")
        return self.send(to, "Your access request", _layout("Access request", intro, None, None, "Contact your administrator if you believe this is a mistake."), text)

    def send_temp_password(self, to: str, name: str, temp_password: str, link: str) -> Dict[str, Any]:
        intro = (f"<p>Hi {html.escape(name)},</p><p>An administrator issued a temporary password for your account. "
                 f"You will be asked to choose a new one when you sign in.</p>"
                 f"<p style='font-family:Consolas,monospace;font-size:18px;background:#f1f5f9;padding:10px 14px;border-radius:8px;display:inline-block'>{html.escape(temp_password)}</p>")
        text = f"Hi {name},\n\nTemporary password: {temp_password}\nSign in at {link} and choose a new password."
        return self.send(to, "Temporary password", _layout("Temporary password", intro, "Sign in", link, "This password can be used once; you must change it at sign-in."), text)

    def send_admin_notice(self, to: str, name: str, subject: str, text: str, link: str) -> Dict[str, Any]:
        intro = f"<p>Hi {html.escape(name)},</p><p>{html.escape(text)}</p>"
        return self.send(to, subject, _layout(subject, intro, "Open User Management", link, "You receive this because you are a superuser."), f"Hi {name},\n\n{text}\n{link}")
