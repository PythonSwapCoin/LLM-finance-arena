import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { PerformanceMetrics } from '../types';
import { INITIAL_CASH } from '../constants';

interface PerformanceChartProps {
  data: PerformanceMetrics[];
  dataKey: keyof PerformanceMetrics;
  color: string;
}

export const PerformanceChart: React.FC<PerformanceChartProps> = ({ data, dataKey, color }) => {
  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">No data available</div>;
  }
  
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <LineChart
        data={data}
        margin={{
          top: 5,
          right: 20,
          left: 20,
          bottom: 5,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis 
            dataKey="timestamp" 
            stroke="#A3A3A3"
            tick={{ fill: '#A3A3A3', fontSize: 12 }}
            label={{ value: 'Day', position: 'insideBottom', offset: -5, fill: '#A3A3A3' }}
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
            formatter={(value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        />
        <Line type="linear" dataKey="totalValue" stroke={color} strokeWidth={2} dot={false} name="Portfolio Value" connectNulls={false} />
        <Line type="linear" dataKey={() => INITIAL_CASH} stroke="#737373" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Initial Capital" connectNulls={false} />

      </LineChart>
    </ResponsiveContainer>
  );
};