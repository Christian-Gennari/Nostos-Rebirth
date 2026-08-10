import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ReadingAckNotificationResult,
  ReadingAddBookAssignmentRequest,
  ReadingBookAssignment,
  ReadingCapture,
  ReadingCaptureRequest,
  ReadingCommandRequest,
  ReadingCommandResult,
  ReadingCommitWeeklyReviewRequest,
  ReadingCompleteBookRequest,
  ReadingCompleteSessionRequest,
  ReadingDashboard,
  ReadingNotification,
  ReadingPlanSessionRequest,
  ReadingProgramme,
  ReadingPromoteCaptureRequest,
  ReadingRateSessionRequest,
  ReadingReorderQueueRequest,
  ReadingResolveCaptureRequest,
  ReadingSession,
  ReadingSessionCommandRequest,
  ReadingSetDefaultBookRequest,
  ReadingSkipRatingsRequest,
  ReadingStartNewSessionRequest,
  ReadingStartSessionRequest,
  ReadingWeeklyReview,
} from '../dtos/reading-training.dtos';

/**
 * Typed HTTP client for the Reading Training REST surface
 * (`/api/reading`, see ReadingTrainingEndpoints.cs).
 *
 * Every mutating command returns the stable `ReadingCommandResult<T>`
 * envelope; the notification lease/ack endpoints return their own shapes.
 * This service is a thin transport layer: it holds no local state, performs
 * no domain transitions, and never generates idempotency keys — callers
 * supply `clientId`/`idempotencyKey` on every command request.
 */
@Injectable({ providedIn: 'root' })
export class ReadingTrainingService {
  private readonly baseUrl = '/api/reading';

  constructor(private readonly http: HttpClient) {}

  // --- programme ---

  initialize(request: ReadingCommandRequest): Observable<ReadingCommandResult<ReadingProgramme>> {
    return this.http.post<ReadingCommandResult<ReadingProgramme>>(`${this.baseUrl}/initialize`, request);
  }

  getDashboard(): Observable<ReadingCommandResult<ReadingDashboard>> {
    return this.http.get<ReadingCommandResult<ReadingDashboard>>(`${this.baseUrl}/dashboard`);
  }

  getStatus(): Observable<ReadingCommandResult<ReadingSession | null>> {
    return this.http.get<ReadingCommandResult<ReadingSession | null>>(`${this.baseUrl}/status`);
  }

  getHistory(): Observable<ReadingCommandResult<ReadingSession[]>> {
    return this.http.get<ReadingCommandResult<ReadingSession[]>>(`${this.baseUrl}/sessions`);
  }

  getInbox(): Observable<ReadingCommandResult<ReadingCapture[]>> {
    return this.http.get<ReadingCommandResult<ReadingCapture[]>>(`${this.baseUrl}/inbox`);
  }

  // --- weekly reviews ---

  previewWeeklyReview(year: number, week: number): Observable<ReadingCommandResult<ReadingWeeklyReview>> {
    return this.http.post<ReadingCommandResult<ReadingWeeklyReview>>(
      `${this.baseUrl}/reviews/preview`,
      { year, week }
    );
  }

  commitWeeklyReview(request: ReadingCommitWeeklyReviewRequest): Observable<ReadingCommandResult<ReadingWeeklyReview>> {
    return this.http.post<ReadingCommandResult<ReadingWeeklyReview>>(`${this.baseUrl}/reviews/commit`, request);
  }

  // --- books / queue ---

  addBook(request: ReadingAddBookAssignmentRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment>>(`${this.baseUrl}/books`, request);
  }

  setDefaultBook(request: ReadingSetDefaultBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.patch<ReadingCommandResult<ReadingBookAssignment>>(
      `${this.baseUrl}/books/${request.bookAssignmentId}`,
      request
    );
  }

  completeBook(request: ReadingCompleteBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment>>(
      `${this.baseUrl}/books/${request.bookAssignmentId}/finish`,
      request
    );
  }

  reorderQueue(request: ReadingReorderQueueRequest): Observable<ReadingCommandResult<ReadingBookAssignment[]>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment[]>>(`${this.baseUrl}/books/reorder`, request);
  }

  // --- sessions ---

  planSession(request: ReadingPlanSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/plan`, request);
  }

  startSession(request: ReadingStartSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/start`, request);
  }

  startNewSession(request: ReadingStartNewSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/start-new`, request);
  }

  pauseSession(request: ReadingSessionCommandRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/pause`, request);
  }

  resumeSession(request: ReadingSessionCommandRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/resume`, request);
  }

  completeSession(request: ReadingCompleteSessionRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/complete`, request);
  }

  rateSession(request: ReadingRateSessionRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/rate`, request);
  }

  skipRatings(request: ReadingSkipRatingsRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/skip-ratings`, request);
  }

  cancelSession(request: ReadingSessionCommandRequest, sessionId: string): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.delete<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/${sessionId}/open`, {
      body: request,
    });
  }

  // --- captures / inbox ---

  capture(request: ReadingCaptureRequest): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.http.post<ReadingCommandResult<ReadingCapture>>(`${this.baseUrl}/captures`, request);
  }

  resolveCapture(
    captureId: string,
    request: ReadingResolveCaptureRequest
  ): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.http.patch<ReadingCommandResult<ReadingCapture>>(
      `${this.baseUrl}/captures/${captureId}`,
      request
    );
  }

  promoteCapture(
    captureId: string,
    request: ReadingPromoteCaptureRequest
  ): Observable<ReadingCommandResult<ReadingCapture>> {
    return this.http.post<ReadingCommandResult<ReadingCapture>>(
      `${this.baseUrl}/captures/${captureId}/promote-to-note`,
      request
    );
  }

  // --- notifications (not command envelopes) ---

  leaseNotifications(maxCount = 10, leaseSeconds = 60): Observable<ReadingNotification[]> {
    const params = new HttpParams().set('maxCount', maxCount).set('leaseSeconds', leaseSeconds);
    return this.http.get<ReadingNotification[]>(`${this.baseUrl}/notifications/lease`, { params });
  }

  acknowledgeNotification(notificationId: string): Observable<ReadingAckNotificationResult> {
    return this.http.post<ReadingAckNotificationResult>(
      `${this.baseUrl}/notifications/${notificationId}/ack`,
      null
    );
  }
}
