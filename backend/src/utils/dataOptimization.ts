import { PerformanceMetrics } from '../types.js';

/**
 * Downsamples an array of performance metrics to a target size.
 * Preserves the first and last points, and picks evenly spaced points in between.
 * 
 * @param data The original array of performance metrics
 * @param targetCount The desired maximum number of points (default: 1000)
 * @returns The downsampled array
 */
export const downsamplePerformanceMetrics = (
    data: PerformanceMetrics[],
    targetCount: number = 1000
): PerformanceMetrics[] => {
    if (!data || data.length <= targetCount) {
        return data;
    }

    const downsampled: PerformanceMetrics[] = [];

    // Always include the first point
    downsampled.push(data[0]);

    // Calculate step size to pick intermediate points
    // We need to pick (targetCount - 2) points from the middle (data.length - 2) items
    const step = (data.length - 1) / (targetCount - 1);

    for (let i = 1; i < targetCount - 1; i++) {
        const index = Math.floor(i * step);
        if (index > 0 && index < data.length - 1) {
            downsampled.push(data[index]);
        }
    }

    // Always include the last point
    if (data.length > 1) {
        downsampled.push(data[data.length - 1]);
    }

    return downsampled;
};
