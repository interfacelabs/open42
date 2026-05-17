import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { colors } from '@/utils/theme';

import { AppText } from './ui/Text';

interface BackButtonProps {
  onPress: () => void;
}

export const BackButton: React.FC<BackButtonProps> = ({ onPress }) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="flex-row items-center"
      hitSlop={12}
      onPress={onPress}>
      <ChevronLeft size={18} color={colors.textBody} strokeWidth={1.5} />
      <AppText variant="caption" weight="medium" tone="body">
        Back
      </AppText>
    </Pressable>
  );
};
