import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'Maps App',
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }} 
      />
      <Stack.Screen 
        name="map" 
        options={{ 
          title: 'Route',
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#fff',
        }} 
      />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}