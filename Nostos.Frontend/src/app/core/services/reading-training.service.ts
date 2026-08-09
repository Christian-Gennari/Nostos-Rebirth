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
 * (`/api/reading-training`, see ReadingTrainingEndpoints.cs).
 *
 * Every mutating command returns the stable `ReadingCommandResult<T>`
 * envelope; the notification lease/ack endpoints return their own shapes.
 * This service is a thin transport layer: it holds no local state, performs
 * no domain transitions, and never generates idempotency keys — callers
 * supply `clientId`/`idempotencyKey` on every command request.
 */
@Injectable({ providedIn: 'root' })
export class ReadingTrainingService {
  private readonly baseUrl = '/api/reading-training';

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
    return this.http.get<ReadingCommandResult<ReadingSession[]>>(`${this.baseUrl}/history`);
  }

  getInbox(): Observable<ReadingCommandResult<ReadingCapture[]>> {
    return this.http.get<ReadingCommandResult<ReadingCapture[]>>(`${this.baseUrl}/inbox`);
  }

  // --- weekly reviews ---

  previewWeeklyReview(year: number, week: number): Observable<ReadingCommandResult<ReadingWeeklyReview>> {
    return this.http.get<ReadingCommandResult<ReadingWeeklyReview>>(
      `${this.baseUrl}/weekly-reviews/${year}/${week}/preview`
    );
  }

  commitWeeklyReview(request: ReadingCommitWeeklyReviewRequest): Observable<ReadingCommandResult<ReadingWeeklyReview>> {
    return this.http.post<ReadingCommandResult<ReadingWeeklyReview>>(`${this.baseUrl}/weekly-reviews/commit`, request);
  }

  // --- books / queue ---

  addBook(request: ReadingAddBookAssignmentRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment>>(`${this.baseUrl}/books`, request);
  }

  setDefaultBook(request: ReadingSetDefaultBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment>>(`${this.baseUrl}/books/default`, request);
  }

  completeBook(request: ReadingCompleteBookRequest): Observable<ReadingCommandResult<ReadingBookAssignment>> {
    return this.http.post<ReadingCommandResult<ReadingBookAssignment>>(`${this.baseUrl}/books/complete`, request);
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

  pauseSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/pause`, request);
  }

  resumeSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/resume`, request);
  }

  completeSession(request: ReadingCompleteSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/complete`, request);
  }

  rateSession(request: ReadingRateSessionRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/rate`, request);
  }

  skipRatings(request: ReadingSkipRatingsRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/skip-ratings`, request);
  }

  cancelSession(request: ReadingSessionCommandRequest): Observable<ReadingCommandResult<ReadingSession>> {
    return this.http.post<ReadingCommandResult<ReadingSession>>(`${this.baseUrl}/sessions/cancel`, request);
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
      `${this.baseUrl}/captures/${captureId}/resolve`,
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
