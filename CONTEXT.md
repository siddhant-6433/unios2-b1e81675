# UniOs

UniOs manages admissions, lead follow-up, applicant journeys, payments, communications, and student operations across NIMT/Mirai contexts. This glossary pins down the admissions and communication language used across the codebase.

## Language

**Lead transition**:
A change from one lead stage to another, treated as a domain event with an old stage, new stage, reason, and source.
_Avoid_: stage update, status update, stage write

**Lead transition command**:
A named admission action that requests a lead transition, such as marking DNC, scheduling a visit, issuing an offer, or recording a disposition.
_Avoid_: generic stage setter, direct stage edit

**Application dossier**:
The canonical read model for an applicant's admission state across application, lead, offer, payment, document review, and PAN/AN information.
_Avoid_: application row, lifecycle blob, app summary

**Conversation action**:
A communication action in a WhatsApp conversation, including manual replies, template sends, AI replies, campaign sends, DNC acknowledgements, and handoffs.
_Avoid_: WhatsApp send, message insert, provider call
