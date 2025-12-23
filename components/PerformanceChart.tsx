import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PerformanceMetrics } from '../types';
import { INITIAL_CASH } from '../constants';
import { formatTimestampToDate } from '../utils/timeFormatting';
import { normalizeTimestampToUnixSeconds } from '../utils/marketTime';

interface PerformanceChartProps {
  data: PerformanceMetrics[];
  dataKey: keyof PerformanceMetrics;
  color: string;
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
}

export const PerformanceChart: React.FC<PerformanceChartProps> = ({
  data,
  dataKey,
  color,
  startDate,
  currentDate,
  simulationMode,
}) => {
  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">No data available</div>;
  }

  const chartData = React.useMemo(
    () =>
      data.map(point => ({
        ...point,
        chartTimestamp: normalizeTimestampToUnixSeconds(point.timestamp, startDate) ?? point.timestamp
      })),
    [data, startDate]
  );

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <LineChart
        data={chartData}
        margin={{
          top: 5,
          right: 20,
          left: 20,
          bottom: 5,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="chartTimestamp"
          stroke="#A3A3A3"
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value) => {
            const numericValue = typeof value === 'number' ? value : Number(value);
            // Find the actual data point that matches this timestamp
            const sourcePoint = chartData.find(d => Math.abs((d.chartTimestamp as number) - numericValue) < 60)
              || chartData.find(d => Math.abs((d.chartTimestamp as number) - numericValue) < 1);
            
            return formatTimestampToDate(
              numericValue,
              startDate,
              currentDate,
              simulationMode,
              sourcePoint?.timestamp,
              sourcePoint?.intradayHour,
              true // compact mode for x-axis labels
            );
          }}
        />
        <YAxis
            stroke="#A3A3A3"
            tick={{ fill: '#A3A3A3', fontSize: 12 }}
            tickFormatter={(value) => typeof value === 'number' ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''}
            domain={['dataMin', 'dataMax']}
            allowDataOverflow={true}
            width={80}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1A1A1A',
            border: '1px solid #262626',
            borderRadius: '0.5rem',
          }}
          labelStyle={{ color: '#F5F5F5' }}
          labelFormatter={(label, payload) => {
            const numericLabel = typeof label === 'number' ? label : Number(label);
            const sourcePoint = (payload && payload[0] && payload[0].payload) as PerformanceMetrics | undefined;
            return formatTimestampToDate(
              numericLabel,
              startDate,
              currentDate,
              simulationMode,
              sourcePoint?.timestamp,
              sourcePoint?.intradayHour
            );
          }}
          formatter={(value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        />
        <Line type="linear" dataKey={dataKey as string} stroke={color} strokeWidth={2} dot={false} name="Portfolio Value" connectNulls={false} />
        {dataKey === 'totalValue' && (
          <Line
            type="linear"
            dataKey={() => INITIAL_CASH}
            stroke="#737373"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            name="Initial Capital"
            connectNulls={false}
          />
        )}

      </LineChart>
    </ResponsiveContainer>
  );
};
