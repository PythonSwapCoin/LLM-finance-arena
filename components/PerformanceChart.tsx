
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { PerformanceMetrics } from '../types';

interface PerformanceChartProps {
  data: PerformanceMetrics[];
  dataKey: keyof PerformanceMetrics;
}

export const PerformanceChart: React.FC<PerformanceChartProps> = ({ data, dataKey }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{
          top: 5,
          right: 30,
          left: 20,
          bottom: 5,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis 
            dataKey="timestamp" 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            label={{ value: 'Day', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
        />
        <YAxis 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            tickFormatter={(value) => typeof value === 'number' ? `$${(value / 1000).toFixed(0)}k` : value}
            domain={['auto', 'auto']}
        />
        <Tooltip
            contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
            }}
            labelStyle={{ color: '#F9FAFB' }}
            formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value}
        />
        <Legend wrapperStyle={{fontSize: "12px"}}/>
        <Line type="monotone" dataKey={dataKey} stroke="#3B82F6" strokeWidth={2} dot={false} name="Portfolio Value" />
      </LineChart>
    </ResponsiveContainer>
  );
};
