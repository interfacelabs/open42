import { type ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from './ui/Text';

interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ eyebrow, title, body, action }: EmptyStateProps) {
  return (
    <View className="items-center px-4 py-10 text-center">
      {eyebrow ? (
        <AppText variant="eyebrow" tone="faint" weight="medium">
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="section" weight="medium" style={{ marginTop: 8, textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText variant="muted" tone="subtle" style={{ marginTop: 8, textAlign: 'center' }}>
        {body}
      </AppText>
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}
