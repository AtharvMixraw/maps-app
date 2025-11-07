import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';

export default function Index() {
  const router = useRouter();
  const [currentLocation, setCurrentLocation] = useState('');
  const [destination, setDestination] = useState('');

  const handleNavigate = () => {
    if (currentLocation.trim() && destination.trim()) {
      router.push({
        pathname: '/map',
        params: { 
          currentLocation, 
          destination 
        }
      });
    } else {
      Alert.alert('Error', 'Please enter both locations');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Where to? 🗺️</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Current Location"
        placeholderTextColor="#999"
        value={currentLocation}
        onChangeText={setCurrentLocation}
      />
      
      <TextInput
        style={styles.input}
        placeholder="Destination"
        placeholderTextColor="#999"
        value={destination}
        onChangeText={setDestination}
      />
      
      <TouchableOpacity style={styles.button} onPress={handleNavigate}>
        <Text style={styles.buttonText}>Show Route</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 40,
    textAlign: 'center',
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: '#000000',
    padding: 18,
    borderRadius: 10,
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
});