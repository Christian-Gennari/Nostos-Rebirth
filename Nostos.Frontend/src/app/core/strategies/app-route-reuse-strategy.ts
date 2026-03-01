import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

export class AppRouteReuseStrategy implements RouteReuseStrategy {
  private handlers: { [key: string]: DetachedRouteHandle } = {};

  /**
   * Determines if this route (and its subtree) should be detached to be reused later.
   * We only detach if the route data explicitly says 'shouldReuse: true'.
   */
  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return route.data['shouldReuse'] === true;
  }

  /**
   * Stores the detached route.
   * We use the route's path as the unique key for storage.
   */
  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
    if (route.routeConfig?.path) {
      this.handlers[route.routeConfig.path] = handle;
    }
  }

  /**
   * Determines if this route (and its subtree) should be reattached.
   */
  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return !!route.routeConfig?.path && !!this.handlers[route.routeConfig.path];
  }

  /**
   * Retrieves the previously stored route.
   */
  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    if (!route.routeConfig?.path) return null;
    return this.handlers[route.routeConfig.path] || null;
  }

  /**
   * Determines if a route should be reused.
   * This is the default Angular behavior (reuse if same route config), but required to be implemented.
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
